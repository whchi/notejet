import { buildSessionGate, getSessionActionLabel } from '../shared/popup-session-gate.js';
import { readCachedSession, writeCachedSession } from '../shared/session-cache.js';
import { filterYouTubeVideosByQuery } from '../shared/youtube-channel.js';

const NOTEBOOK_HOME_URL = 'https://notebooklm.google.com/';

const state = {
  source: null,
  notebooks: [],
  selectedNotebook: null,
  busy: false,
  sourceValidationValid: false,
  youtubeChannel: null,
  hasYoutubeDataApiKey: false,
  youtubeVideos: [],
  selectedVideoIds: new Set<string>(),
  sessionState: readCachedSession(window.localStorage) || { valid: false },
  sessionGate: buildSessionGate(readCachedSession(window.localStorage) || { valid: false }),
};

const sourceTitleEl = document.getElementById('sourceTitle') as HTMLInputElement;
const sourceUrlEl = document.getElementById('sourceUrl') as HTMLInputElement;
const searchInputEl = document.getElementById('searchInput') as HTMLInputElement;
const notebookListEl = document.getElementById('notebookList') as HTMLUListElement;
const newNotebookInputEl = document.getElementById('newNotebookInput') as HTMLInputElement;
const createButtonEl = document.getElementById('createButton') as HTMLButtonElement;
const importButtonEl = document.getElementById('importButton') as HTMLButtonElement;
const refreshSessionButtonEl = document.getElementById('refreshSessionButton') as HTMLButtonElement;
const openNotebookLinkEl = document.getElementById('openNotebookLink') as HTMLAnchorElement;
const sourceValidationEl = document.getElementById('sourceValidation') as HTMLElement;
const openImportPolicyOptionsEl = document.getElementById('openImportPolicyOptions') as HTMLButtonElement;
const loadYouTubeChannelButtonEl = document.getElementById('loadYouTubeChannelButton') as HTMLButtonElement;
const youtubeChannelHelpEl = document.getElementById('youtubeChannelHelp') as HTMLElement;
const youtubeVideoSectionEl = document.getElementById('youtubeVideoSection') as HTMLElement;
const youtubeChannelTitleEl = document.getElementById('youtubeChannelTitle') as HTMLElement;
const videoSearchInputEl = document.getElementById('videoSearchInput') as HTMLInputElement;
const youtubeVideoListEl = document.getElementById('youtubeVideoList') as HTMLUListElement;
const toggleAllVideosButtonEl = document.getElementById('toggleAllVideosButton') as HTMLButtonElement;
const importSelectedVideosButtonEl = document.getElementById('importSelectedVideosButton') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLElement;

void bootstrap();

searchInputEl.addEventListener('input', debounce(onSearchInput, 250));
videoSearchInputEl.addEventListener('input', () => {
  renderYouTubeVideoList();
});
createButtonEl.addEventListener('click', () => void handleCreateNotebook());
importButtonEl.addEventListener('click', () => void handleImport());
loadYouTubeChannelButtonEl.addEventListener('click', () => void handleLoadYouTubeChannel());
toggleAllVideosButtonEl.addEventListener('click', () => {
  handleToggleAllVideos();
});
importSelectedVideosButtonEl.addEventListener('click', () => void handleImportSelectedVideos());
sourceTitleEl.addEventListener('input', () => {
  if (state.source) {
    state.source.title = sourceTitleEl.value;
  }
});
refreshSessionButtonEl.addEventListener('click', () => void handleRefreshSession());
openImportPolicyOptionsEl.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});
openNotebookLinkEl.addEventListener('click', event => {
  event.preventDefault();
  if (!state.sessionState?.valid) {
    void sendMessage({ type: 'OPEN_NOTEBOOK', notebook: { url: NOTEBOOK_HOME_URL } });
    return;
  }
  if (!state.selectedNotebook?.url) {
    return;
  }
  void sendMessage({ type: 'OPEN_NOTEBOOK', notebook: state.selectedNotebook });
});

async function bootstrap() {
  setStatus('Loading context...');

  try {
    const bootstrapResult = await sendMessage({ type: 'GET_BOOTSTRAP' });
    state.source = bootstrapResult.source;

    sourceTitleEl.value = state.source.title;
    sourceUrlEl.value = state.source.url;
    applySourceValidation(bootstrapResult.sourceValidation);
    state.youtubeChannel = bootstrapResult.youtubeChannel || null;
    state.hasYoutubeDataApiKey = Boolean(bootstrapResult.hasYoutubeDataApiKey);
    applyYouTubeChannelState();

    applySessionState(bootstrapResult.sessionState);

    // --- DIAGNOSTIC: show session check evidence ---
    if (bootstrapResult.sessionState?._diag) {
      // Note: this is intentionally verbose and unformatted for easy copy-paste extraction and debugging.
      //   console.log("[NoteJet DIAG] session diagnostics:", JSON.stringify(bootstrapResult.sessionState._diag, null, 2));
      //   showDiagnostics(bootstrapResult.sessionState._diag);
    }
    // --- END DIAGNOSTIC ---

    if (Array.isArray(bootstrapResult.recentNotebooks)) {
      state.notebooks = bootstrapResult.recentNotebooks;
      renderNotebookList();
    }

    if (state.sessionGate.canSearch) {
      await fetchNotebooks('');
      setStatus('Ready.', 'success');
    } else {
      setStatus(state.sessionGate.statusMessage, 'error');
    }
  } catch (error) {
    setStatus(String(error), 'error');
  }
}

async function onSearchInput() {
  if (!state.sessionGate.canSearch) {
    setStatus(state.sessionGate.statusMessage, 'error');
    return;
  }
  await fetchNotebooks(searchInputEl.value.trim());
}

async function fetchNotebooks(query) {
  if (!state.sessionGate.canSearch) {
    setStatus(state.sessionGate.statusMessage, 'error');
    return;
  }

  setBusy(true);
  try {
    const result = await sendMessage({ type: 'LIST_NOTEBOOKS', query });
    state.notebooks = result.notebooks;

    if (state.selectedNotebook && !state.notebooks.some(item => item.id === state.selectedNotebook.id)) {
      state.selectedNotebook = null;
      openNotebookLinkEl.classList.add('hidden');
    }

    renderNotebookList();
    setStatus(`Found ${state.notebooks.length} notebooks.`);
  } catch (error) {
    setStatus(String(error), 'error');
  } finally {
    setBusy(false);
  }
}

async function handleCreateNotebook() {
  if (!state.sessionGate.canCreate) {
    setStatus(state.sessionGate.statusMessage, 'error');
    updateOpenLink();
    return;
  }

  const name = newNotebookInputEl.value.trim();
  if (!name) {
    setStatus('Enter a notebook name first.', 'error');
    return;
  }

  setBusy(true);
  setStatus('Creating notebook...');

  try {
    const result = await sendMessage({ type: 'CREATE_NOTEBOOK', name });
    applySessionState({ valid: true, lastCheckedAt: Date.now(), reason: '' });
    state.selectedNotebook = result.notebook;
    newNotebookInputEl.value = '';

    await fetchNotebooks('');
    setStatus('Notebook created.', 'success');
    updateOpenLink();
  } catch (error) {
    handleOperationError(error);
  } finally {
    setBusy(false);
  }
}

async function handleImport() {
  if (!state.sessionGate.canImport) {
    setStatus(state.sessionGate.statusMessage, 'error');
    updateOpenLink();
    return;
  }

  if (!state.selectedNotebook) {
    setStatus('Select a notebook first.', 'error');
    return;
  }
  if (!state.source?.url) {
    setStatus('No source URL detected in active tab.', 'error');
    return;
  }

  // Update source title from input to ensure latest edited value is used
  const editedTitle = sourceTitleEl.value.trim();
  if (editedTitle) {
    state.source.title = editedTitle;
  }

  if (!state.sourceValidationValid) {
    const reason = sourceValidationEl.textContent || 'Source URL is not allowed by whitelist.';
    setStatus(reason, 'error');
    return;
  }

  setBusy(true);
  setStatus('Importing source into NotebookLM...');

  try {
    await sendMessage({
      type: 'IMPORT_TO_NOTEBOOK',
      notebook: state.selectedNotebook,
      source: state.source,
    });
    applySessionState({ valid: true, lastCheckedAt: Date.now(), reason: '' });
    setStatus('Import completed.', 'success');
    updateOpenLink();
  } catch (error) {
    handleOperationError(error);
  } finally {
    setBusy(false);
  }
}

async function handleLoadYouTubeChannel() {
  if (!state.youtubeChannel) {
    setStatus('Open a YouTube channel profile before importing channel videos.', 'error');
    return;
  }

  if (!state.hasYoutubeDataApiKey) {
    setYouTubeHelp('Add a YouTube Data API key in options first.', 'error');
    setStatus('YouTube Data API key is required before channel import.', 'error');
    return;
  }

  setBusy(true);
  setYouTubeHelp('Loading channel videos...');

  try {
    const result = await sendMessage({
      type: 'GET_YOUTUBE_CHANNEL_VIDEOS',
      sourceUrl: state.source.url,
    });
    state.youtubeChannel = result.channel;
    state.youtubeVideos = result.videos || [];
    state.selectedVideoIds.clear();
    youtubeVideoSectionEl.classList.remove('hidden');
    importSelectedVideosButtonEl.classList.remove('hidden');
    youtubeChannelTitleEl.textContent = state.youtubeChannel.title || state.youtubeChannel.value;
    renderYouTubeVideoList();
    setYouTubeHelp(`${state.youtubeVideos.length} videos loaded.`);
    setStatus(`Found ${state.youtubeVideos.length} YouTube videos.`);
  } catch (error) {
    setYouTubeHelp(String(error), 'error');
    setStatus(String(error), 'error');
  } finally {
    setBusy(false);
  }
}

async function handleImportSelectedVideos() {
  if (!state.sessionGate.canImport) {
    setStatus(state.sessionGate.statusMessage, 'error');
    updateOpenLink();
    return;
  }

  if (!state.selectedNotebook) {
    setStatus('Select a notebook first.', 'error');
    return;
  }

  const videos = state.youtubeVideos.filter(video => state.selectedVideoIds.has(video.id));
  if (!videos.length) {
    setStatus('Select at least one YouTube video first.', 'error');
    return;
  }

  setBusy(true);
  setStatus(`Importing ${videos.length} selected videos...`);

  try {
    const result = await sendMessage({
      type: 'IMPORT_YOUTUBE_VIDEOS_TO_NOTEBOOK',
      notebook: state.selectedNotebook,
      videos,
    });
    applySessionState({ valid: true, lastCheckedAt: Date.now(), reason: '' });
    updateOpenLink();

    if (result.failedCount) {
      setStatus(`Imported ${result.importedCount}; ${result.failedCount} failed.`, 'error');
      return;
    }

    setStatus(`Imported ${result.importedCount} videos.`, 'success');
  } catch (error) {
    handleOperationError(error);
  } finally {
    setBusy(false);
  }
}

async function handleRefreshSession() {
  setBusy(true);
  setStatus('Refreshing session...');

  try {
    const sessionState = await sendMessage({ type: 'REFRESH_SESSION' });
    applySessionState(sessionState);

    if (sessionState.valid) {
      await fetchNotebooks('');
      setStatus('Session refreshed. Ready.', 'success');
    } else {
      setStatus(state.sessionGate.statusMessage, 'error');
    }
  } catch (error) {
    setStatus(String(error), 'error');
  } finally {
    setBusy(false);
  }
}

function renderNotebookList() {
  notebookListEl.innerHTML = '';

  if (!state.notebooks.length) {
    const empty = document.createElement('li');
    empty.className = 'notebook-item';
    empty.textContent = 'No notebook found. Open NotebookLM and refresh.';
    notebookListEl.appendChild(empty);
    importButtonEl.disabled = true;
    return;
  }

  for (const notebook of state.notebooks) {
    const li = document.createElement('li');
    li.className = 'notebook-item';
    li.tabIndex = 0;
    li.setAttribute('role', 'button');

    if (state.selectedNotebook?.id === notebook.id) {
      li.classList.add('selected');
    }

    const title = document.createElement('p');
    title.className = 'nb-title';
    title.textContent = notebook.title || 'Untitled notebook';

    const meta = document.createElement('p');
    meta.className = 'nb-meta';
    meta.textContent = notebook.isRecent ? 'recent' : notebook.id;

    const selectNotebook = (fromKeyboard = false) => {
      state.selectedNotebook = notebook;
      renderNotebookList();
      updateOpenLink();
      updateVideoImportButton();
      if (fromKeyboard) {
        const selectedItem = notebookListEl.querySelector('.notebook-item.selected') as HTMLElement | null;
        selectedItem?.focus();
      }
    };

    li.setAttribute('aria-pressed', String(state.selectedNotebook?.id === notebook.id));

    li.appendChild(title);
    li.appendChild(meta);
    li.addEventListener('click', () => selectNotebook());
    li.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.repeat) {
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectNotebook(true);
      }
    });

    notebookListEl.appendChild(li);
  }

  importButtonEl.disabled = !state.selectedNotebook || state.busy || !state.sourceValidationValid;
  updateVideoImportButton();
}

function updateOpenLink() {
  if (!state.sessionState?.valid) {
    openNotebookLinkEl.classList.remove('hidden');
    openNotebookLinkEl.href = NOTEBOOK_HOME_URL;
    openNotebookLinkEl.textContent = getSessionActionLabel(state.sessionState);
    return;
  }

  if (!state.selectedNotebook?.url) {
    openNotebookLinkEl.classList.add('hidden');
    openNotebookLinkEl.href = '#';
    openNotebookLinkEl.textContent = 'Open notebook';
    return;
  }

  openNotebookLinkEl.classList.remove('hidden');
  openNotebookLinkEl.href = state.selectedNotebook.url;
  openNotebookLinkEl.textContent = getSessionActionLabel(state.sessionState);
}

function setBusy(busy) {
  state.busy = busy;
  createButtonEl.disabled = busy || !state.sessionGate.canCreate;
  searchInputEl.disabled = busy || !state.sessionGate.canSearch;
  newNotebookInputEl.disabled = busy || !state.sessionGate.canCreate;
  importButtonEl.disabled = busy || !state.selectedNotebook || !state.sessionGate.canImport;
  loadYouTubeChannelButtonEl.disabled = busy || !state.youtubeChannel || !state.hasYoutubeDataApiKey;
  videoSearchInputEl.disabled = busy;
  toggleAllVideosButtonEl.disabled = busy || !getVisibleYouTubeVideos().length;
  importSelectedVideosButtonEl.disabled =
    busy || !state.selectedNotebook || !state.sessionGate.canImport || !state.selectedVideoIds.size;
  if (!state.sourceValidationValid) {
    importButtonEl.disabled = true;
  }
  refreshSessionButtonEl.disabled = busy;
  openImportPolicyOptionsEl.disabled = busy;
}

function applyYouTubeChannelState() {
  if (!state.youtubeChannel) {
    loadYouTubeChannelButtonEl.classList.add('hidden');
    youtubeChannelHelpEl.classList.add('hidden');
    youtubeVideoSectionEl.classList.add('hidden');
    importSelectedVideosButtonEl.classList.add('hidden');
    return;
  }

  loadYouTubeChannelButtonEl.classList.remove('hidden');
  youtubeChannelHelpEl.classList.remove('hidden');
  if (!state.hasYoutubeDataApiKey) {
    loadYouTubeChannelButtonEl.disabled = true;
    setYouTubeHelp('Add a YouTube Data API key in options before loading videos.', 'error');
    return;
  }

  loadYouTubeChannelButtonEl.disabled = state.busy;
  setYouTubeHelp(`Ready to load videos from ${state.youtubeChannel.value}.`);
}

function renderYouTubeVideoList() {
  youtubeVideoListEl.innerHTML = '';
  const videos = getVisibleYouTubeVideos();

  if (!videos.length) {
    const empty = document.createElement('li');
    empty.className = 'video-item';
    empty.textContent = state.youtubeVideos.length ? 'No videos match this search.' : 'No videos found.';
    youtubeVideoListEl.appendChild(empty);
    updateVideoImportButton();
    return;
  }

  for (const video of videos) {
    const item = document.createElement('li');
    item.className = 'video-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.selectedVideoIds.has(video.id);
    checkbox.setAttribute('aria-label', `Select ${video.title}`);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        state.selectedVideoIds.add(video.id);
      } else {
        state.selectedVideoIds.delete(video.id);
      }
      updateVideoImportButton();
      updateToggleAllVideosButton(videos);
    });

    const content = document.createElement('div');

    const title = document.createElement('p');
    title.className = 'video-title';
    title.textContent = video.title || video.url;

    const meta = document.createElement('p');
    meta.className = 'video-meta';
    meta.textContent = formatVideoMeta(video);

    content.appendChild(title);
    content.appendChild(meta);
    item.appendChild(checkbox);
    item.appendChild(content);
    youtubeVideoListEl.appendChild(item);
  }

  updateVideoImportButton();
  updateToggleAllVideosButton(videos);
}

function handleToggleAllVideos() {
  const videos = getVisibleYouTubeVideos();
  if (!videos.length) {
    return;
  }

  const allSelected = videos.every(video => state.selectedVideoIds.has(video.id));
  for (const video of videos) {
    if (allSelected) {
      state.selectedVideoIds.delete(video.id);
    } else {
      state.selectedVideoIds.add(video.id);
    }
  }

  renderYouTubeVideoList();
}

function getVisibleYouTubeVideos() {
  return filterYouTubeVideosByQuery(state.youtubeVideos, videoSearchInputEl.value);
}

function updateToggleAllVideosButton(videos = getVisibleYouTubeVideos()) {
  const allSelected = videos.length && videos.every(video => state.selectedVideoIds.has(video.id));
  toggleAllVideosButtonEl.textContent = allSelected ? 'Clear' : 'All';
  toggleAllVideosButtonEl.disabled = state.busy || !videos.length;
}

function updateVideoImportButton() {
  const count = state.selectedVideoIds.size;
  importSelectedVideosButtonEl.disabled = state.busy || !state.selectedNotebook || !state.sessionGate.canImport || !count;
  const label = count ? `Import ${count} selected videos` : 'Import selected videos';
  importSelectedVideosButtonEl.querySelector('span').textContent = label;
}

function formatVideoMeta(video) {
  const parts = [];
  if (video.channelTitle) {
    parts.push(video.channelTitle);
  }
  if (video.publishedAt) {
    parts.push(video.publishedAt.slice(0, 10));
  }
  return parts.join(' · ') || video.url;
}

function setYouTubeHelp(message, type = '') {
  youtubeChannelHelpEl.textContent = message;
  youtubeChannelHelpEl.classList.remove('error');
  if (type) {
    youtubeChannelHelpEl.classList.add(type);
  }
}

function applySourceValidation(validation) {
  const valid = Boolean(validation?.valid);
  const reason = validation?.reason || '';
  state.sourceValidationValid = valid;
  if (valid) {
    sourceValidationEl.textContent = 'Source URL allowed by whitelist.';
    sourceValidationEl.classList.remove('error');
  } else {
    sourceValidationEl.textContent = reason || 'Source URL is not allowed by whitelist.';
    sourceValidationEl.classList.add('error');
  }
}

function setStatus(message, type = '') {
  statusEl.textContent = message;
  statusEl.classList.remove('error', 'success');
  if (type) {
    statusEl.classList.add(type);
  }
}

async function sendMessage(payload) {
  const response = await chrome.runtime.sendMessage(payload);
  if (!response?.ok) {
    throw new Error(response?.error || 'Extension operation failed.');
  }
  return response.data;
}

function debounce(callback: (...args: unknown[]) => void, delayMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: unknown[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delayMs);
  };
}

function applySessionState(sessionState) {
  const normalized =
    sessionState && typeof sessionState === 'object'
      ? {
          valid: Boolean(sessionState.valid),
          lastCheckedAt: Number(sessionState.lastCheckedAt) || Date.now(),
          reason: sessionState.reason || '',
        }
      : {
          valid: false,
          lastCheckedAt: Date.now(),
          reason: 'LOGIN_REQUIRED',
        };

  state.sessionState = normalized;
  state.sessionGate = buildSessionGate(normalized);
  writeCachedSession(window.localStorage, normalized);
  setBusy(state.busy);
  updateOpenLink();
}

function handleOperationError(error) {
  const message = String(error);
  if (message.toLowerCase().includes('login expired')) {
    applySessionState({ valid: false, reason: 'LOGIN_REQUIRED', lastCheckedAt: Date.now() });
    setStatus(state.sessionGate.statusMessage, 'error');
    return;
  }
  setStatus(message, 'error');
}

// --- DIAGNOSTIC: renders session check evidence below status ---
function showDiagnostics(diag) {
  let existing = document.getElementById('diagPanel');
  if (!existing) {
    existing = document.createElement('pre');
    existing.id = 'diagPanel';
    existing.style.cssText =
      'font-size:10px;max-height:200px;overflow:auto;background:#1a1a2e;color:#0f0;' +
      'padding:6px;margin-top:8px;border-radius:4px;white-space:pre-wrap;word-break:break-all;';
    statusEl.parentNode.insertBefore(existing, statusEl.nextSibling);
  }

  const lines = [];
  lines.push('=== NoteJet Session Diagnostics ===');

  if (diag.bridgeError) {
    lines.push(`BRIDGE ERROR: ${diag.bridgeError}`);
    lines.push(`  errorKind: ${diag.errorKind}`);
    lines.push(`  attempt: ${diag.attempt}`);
    existing.textContent = lines.join('\n');
    return;
  }

  lines.push(`bridgeTab: id=${diag.bridgeTabId} url=${diag.bridgeTabUrl}`);
  lines.push(`domStatus: ${diag.domStatus}`);
  lines.push(`scrapeOk: ${diag.scrapeSucceeded} count: ${diag.scrapeNotebookCount}`);
  lines.push(`decision: valid=${diag.decisionValid} reason=${diag.decisionReason}`);
  lines.push(`attempt: ${diag.attempt}`);

  const dom = diag.domDiagnostics;
  if (dom) {
    lines.push('--- DOM evidence ---');
    lines.push(`  page url: ${dom.url}`);
    lines.push(`  readyState: ${dom.readyState}`);
    lines.push(`  hasBody: ${dom.hasBody} bodyLen: ${dom.bodyLength}`);
    lines.push(`  hasNotebookLink: ${dom.hasNotebookLink}`);
    lines.push(`  hasNotebookContainer: ${dom.hasNotebookContainer}`);
    lines.push(`  hasAccountUi: ${dom.hasAccountUi}`);
    lines.push(`  hasLoginHint: ${dom.hasLoginHint}`);
    lines.push(`  matchedAccountSel: ${JSON.stringify(dom.matchedAccountSelectors)}`);
    lines.push(`  matchedLoginHints: ${JSON.stringify(dom.matchedLoginHints)}`);
    lines.push(`  bodySnippet: ${dom.bodySnippet}`);
    if (Array.isArray(dom.linkSample)) {
      lines.push(`  links (${dom.linkSample.length}):`);
      for (const link of dom.linkSample) {
        lines.push(`    ${link.href} | ${link.text}`);
      }
    }
  }

  existing.textContent = lines.join('\n');
}
// --- END DIAGNOSTIC ---
