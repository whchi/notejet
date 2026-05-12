import { createInvalidSession, createValidSession } from '../shared/session-state.js';
import {
  decideSessionFromChecks,
  classifySessionCheckError,
  shouldRetrySessionCheck,
} from '../shared/notebook-session-evaluator.js';
import { extractNotebookHtmlTokens, hasRequiredCookieNames } from '../shared/notebook-api-auth.js';
import {
  buildCreateNotebookRequest,
  filterNotebooksByQuery,
  buildImportSourceRequest,
  buildListNotebooksRequest,
  mapNotebookListPayload,
} from '../shared/notebook-api-operations.js';
import {
  DEFAULT_IMPORT_SOURCE_POLICY,
  normalizeImportSourcePolicy,
  validateImportSourceUrl,
} from '../shared/source-url-policy.js';
import { callNotebookRpc } from '../shared/notebook-api-client.js';
import { extractYouTubeChannelIdentifier, mapYouTubePlaylistItems } from '../shared/youtube-channel.js';

const STORAGE_KEYS = {
  recentNotebooks: 'recentNotebooks',
  notebookSession: 'notebookSession',
  authSnapshot: 'authSnapshot',
  importSourcePolicy: 'importSourcePolicy',
  youtubeDataApiKey: 'youtubeDataApiKey',
};

const NOTEBOOK_BASE_URL = 'https://notebooklm.google.com/';
const YOUTUBE_API_BASE_URL = 'https://www.googleapis.com/youtube/v3/';

chrome.runtime.onInstalled.addListener(() => {
  void initializeStorage();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message, sender)
    .then(result => sendResponse({ ok: true, data: result }))
    .catch(error => {
      sendResponse({
        ok: false,
        error: normalizeError(error),
      });
    });

  return true;
});

async function handleMessage(message, _sender) {
  switch (message?.type) {
    case 'GET_BOOTSTRAP':
      return getBootstrap();
    case 'CHECK_NOTEBOOK_SESSION':
      return checkNotebookSession(Boolean(message.force));
    case 'REFRESH_SESSION':
      return refreshSession();
    case 'LIST_NOTEBOOKS':
      return listNotebooks(message.query || '');
    case 'CREATE_NOTEBOOK':
      return createNotebook(message.name || '');
    case 'IMPORT_TO_NOTEBOOK':
      return importToNotebook(message.notebook, message.source);
    case 'GET_YOUTUBE_CHANNEL_VIDEOS':
      return getYouTubeChannelVideos(message.sourceUrl || '');
    case 'IMPORT_YOUTUBE_VIDEOS_TO_NOTEBOOK':
      return importYouTubeVideosToNotebook(message.notebook, message.videos || []);
    case 'OPEN_NOTEBOOK':
      return openNotebook(message.notebook);
    case 'GET_IMPORT_SOURCE_POLICY':
      return getImportSourcePolicy();
    case 'SET_IMPORT_SOURCE_POLICY':
      return setImportSourcePolicy(message.policy);
    case 'GET_YOUTUBE_DATA_API_KEY':
      return getYouTubeDataApiKey();
    case 'SET_YOUTUBE_DATA_API_KEY':
      return setYouTubeDataApiKey(message.apiKey || '');
    default:
      throw new Error('Unknown message type.');
  }
}

async function getBootstrap() {
  const source = await getActiveTabSource();
  const recentNotebooks = await getRecentNotebooks();
  const sessionState = await checkNotebookSession(false);
  const importSourcePolicy = await getImportSourcePolicy();
  const sourceValidation = validateImportSourceUrl(source.url, importSourcePolicy);
  const youtubeChannel = extractYouTubeChannelIdentifier(source.url);
  const hasYoutubeDataApiKey = Boolean(await getYouTubeDataApiKey());
  return { source, recentNotebooks, sessionState, sourceValidation, youtubeChannel, hasYoutubeDataApiKey };
}

async function listNotebooks(query) {
  await ensureNotebookSession();

  const normalizedQuery = String(query || '').trim();

  const apiResult = await tryListNotebooksViaApi(normalizedQuery);
  if (apiResult.ok) {
    const recent = await getRecentNotebooks();
    const recentById = new Set(recent.map(item => item.id));
    const notebooks = filterNotebooksByQuery(apiResult.notebooks, normalizedQuery).map(item => ({
      ...item,
      isRecent: recentById.has(item.id),
    }));

    return { notebooks };
  }

  const bridgeTab = await ensureNotebookBridgeTab();
  const response = await sendBridgeMessage(bridgeTab.id, {
    type: 'SCRAPE_NOTEBOOKS',
    query: normalizedQuery,
  });

  const recent = await getRecentNotebooks();
  const recentById = new Set(recent.map(item => item.id));
  const notebooks = filterNotebooksByQuery(response.notebooks, normalizedQuery).map(item => ({
    ...item,
    isRecent: recentById.has(item.id),
  }));

  return { notebooks };
}

async function createNotebook(name) {
  await ensureNotebookSession();

  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Notebook name is required.');
  }

  // Try API first
  const apiResult = await tryCreateNotebookViaApi(trimmed);

  if (apiResult.ok) {
    return {
      notebook: apiResult.notebook,
    };
  }

  // Fallback to DOM automation
  const bridgeTab = await ensureNotebookBridgeTab();

  const response = await sendBridgeMessage(bridgeTab.id, {
    type: 'CREATE_NOTEBOOK_DOM',
    name: trimmed,
  });

  if (!response.created) {
    throw new Error('Could not create notebook automatically. Open NotebookLM tab and retry.');
  }

  return {
    notebook: response.notebook,
  };
}

async function importToNotebook(notebook, source) {
  await ensureNotebookSession();

  if (!notebook?.id || !notebook?.url) {
    throw new Error('Notebook target is missing.');
  }
  if (!source?.url) {
    throw new Error('Source URL is missing.');
  }

  const importSourcePolicy = await getImportSourcePolicy();
  const sourceValidation = validateImportSourceUrl(source.url, importSourcePolicy);
  if (!sourceValidation.valid) {
    throw new Error(sourceValidation.reason || 'Source URL is not allowed by whitelist.');
  }

  const apiResult = await tryImportToNotebookViaApi(notebook, source);
  if (apiResult.ok) {
    await pushRecentNotebook(notebook);
    return {
      imported: true,
      notebook,
    };
  }

  const notebookTab = await openNotebookInReusableTab(notebook.url);
  const response = await sendBridgeMessage(notebookTab.id, {
    type: 'IMPORT_SOURCE_DOM',
    source,
  });

  if (!response.imported) {
    throw new Error('Import automation failed. Notebook page is opened; you can paste manually.');
  }

  await pushRecentNotebook(notebook);
  return {
    imported: true,
    notebook,
  };
}

async function getYouTubeChannelVideos(sourceUrl) {
  const channel = extractYouTubeChannelIdentifier(sourceUrl);
  if (!channel) {
    throw new Error('Open a YouTube channel profile before importing channel videos.');
  }

  const apiKey = await getYouTubeDataApiKey();
  if (!apiKey) {
    throw new Error('YouTube Data API key is required before importing channel videos.');
  }

  const channelInfo = await fetchYouTubeChannelInfo(apiKey, channel);
  const videos = await fetchYouTubePlaylistVideos(apiKey, channelInfo.uploadsPlaylistId);

  return {
    channel: {
      ...channel,
      title: channelInfo.title,
    },
    videos,
  };
}

async function importYouTubeVideosToNotebook(notebook, videos) {
  if (!Array.isArray(videos) || !videos.length) {
    throw new Error('Select at least one YouTube video to import.');
  }

  const results = [];
  for (const video of videos) {
    try {
      await importToNotebook(notebook, {
        title: video.title || video.url,
        url: video.url,
      });
      results.push({ video, imported: true });
    } catch (error) {
      results.push({ video, imported: false, error: normalizeError(error) });
    }
  }

  return {
    importedCount: results.filter(item => item.imported).length,
    failedCount: results.filter(item => !item.imported).length,
    results,
  };
}

async function fetchYouTubeChannelInfo(apiKey, channel) {
  const params = new URLSearchParams({
    part: 'snippet,contentDetails',
    key: apiKey,
  });

  if (channel.type === 'channelId') {
    params.set('id', channel.value);
  } else {
    params.set('forHandle', channel.value);
  }

  const data = await fetchYouTubeApi(`channels?${params.toString()}`);
  const item = Array.isArray(data.items) ? data.items[0] : null;
  const uploadsPlaylistId = item?.contentDetails?.relatedPlaylists?.uploads;
  if (!item || !uploadsPlaylistId) {
    throw new Error('Could not resolve this YouTube channel from the current page.');
  }

  return {
    title: item?.snippet?.title || channel.value,
    uploadsPlaylistId,
  };
}

async function fetchYouTubePlaylistVideos(apiKey, playlistId) {
  const videos = [];
  let pageToken = '';

  do {
    const params = new URLSearchParams({
      part: 'snippet,contentDetails',
      playlistId,
      maxResults: '50',
      key: apiKey,
    });

    if (pageToken) {
      params.set('pageToken', pageToken);
    }

    const data = await fetchYouTubeApi(`playlistItems?${params.toString()}`);
    videos.push(...mapYouTubePlaylistItems(data.items));
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  return videos;
}

async function fetchYouTubeApi(path) {
  const response = await fetch(`${YOUTUBE_API_BASE_URL}${path}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.error?.message || response.statusText || 'YouTube Data API request failed.';
    throw new Error(`YouTube Data API error: ${detail}`);
  }
  return data;
}

async function openNotebook(notebook) {
  if (!notebook?.url) {
    throw new Error('Notebook URL is missing.');
  }

  await chrome.tabs.create({ url: notebook.url });
  return { opened: true };
}

async function initializeStorage() {
  const current = await chrome.storage.local.get([
    STORAGE_KEYS.recentNotebooks,
    STORAGE_KEYS.notebookSession,
    STORAGE_KEYS.importSourcePolicy,
  ]);

  if (!Array.isArray(current[STORAGE_KEYS.recentNotebooks])) {
    await chrome.storage.local.set({ [STORAGE_KEYS.recentNotebooks]: [] });
  }

  if (!current[STORAGE_KEYS.notebookSession]) {
    await setNotebookSessionState(createInvalidSession('LOGIN_REQUIRED'));
  }

  if (!current[STORAGE_KEYS.importSourcePolicy]) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.importSourcePolicy]: { ...DEFAULT_IMPORT_SOURCE_POLICY },
    });
  }
}

async function getImportSourcePolicy() {
  const data = await chrome.storage.local.get([STORAGE_KEYS.importSourcePolicy]);
  return normalizeImportSourcePolicy(data[STORAGE_KEYS.importSourcePolicy]);
}

async function setImportSourcePolicy(policyInput) {
  const policy = normalizeImportSourcePolicy(policyInput);
  await chrome.storage.local.set({ [STORAGE_KEYS.importSourcePolicy]: policy });
  return policy;
}

async function getYouTubeDataApiKey() {
  const data = await chrome.storage.local.get([STORAGE_KEYS.youtubeDataApiKey]);
  return String(data[STORAGE_KEYS.youtubeDataApiKey] || '').trim();
}

async function setYouTubeDataApiKey(apiKeyInput) {
  const apiKey = String(apiKeyInput || '').trim();
  await chrome.storage.local.set({ [STORAGE_KEYS.youtubeDataApiKey]: apiKey });
  return apiKey;
}

async function getRecentNotebooks() {
  const data = await chrome.storage.local.get([STORAGE_KEYS.recentNotebooks]);
  const list = data[STORAGE_KEYS.recentNotebooks];
  if (!Array.isArray(list)) {
    return [];
  }
  return list;
}

async function getStoredNotebookSession() {
  const data = await chrome.storage.local.get([STORAGE_KEYS.notebookSession]);
  const value = data[STORAGE_KEYS.notebookSession];
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value;
}

async function setNotebookSessionState(sessionState) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.notebookSession]: sessionState,
  });
}

async function checkNotebookSession(_force) {
  // Primary check: try the API path. This mirrors notebooklm-py's from_storage():
  //   1. verify cookies (SID present)
  //   2. fetch NotebookLM home page and extract SNlM0e + FdrFJe tokens
  //   3. if redirected to accounts.google.com -> not logged in
  const apiSession = await tryCheckSessionViaApi();
  if (apiSession.ok) {
    const valid = createValidSession();
    valid._diag = { mode: 'api', attempt: 0 };
    await setNotebookSessionState(valid);
    return valid;
  }

  // API path failed. If the error is a definitive auth failure (redirect or missing
  // cookies), clear the cached snapshot and report invalid immediately without
  // spinning up a bridge tab.
  if (apiSession.definitive) {
    await clearAuthSnapshot();
    const invalid = createInvalidSession('LOGIN_REQUIRED');
    invalid._diag = { mode: 'api_auth_failed', apiError: apiSession.error || '' };
    await setNotebookSessionState(invalid);
    return invalid;
  }

  // Non-definitive failure (network error, etc.): fall back to DOM check.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const bridgeTab = await ensureNotebookBridgeTab();
      const domResult = await sendBridgeMessage(bridgeTab.id, { type: 'CHECK_LOGIN_DOM' });

      let scrapeResult = null;
      try {
        scrapeResult = await sendBridgeMessage(bridgeTab.id, {
          type: 'SCRAPE_NOTEBOOKS',
          query: '',
        });
      } catch (_error) {
        scrapeResult = null;
      }

      const decision = decideSessionFromChecks({
        domStatus: domResult.status,
        notebooksCount: Array.isArray(scrapeResult?.notebooks) ? scrapeResult.notebooks.length : 0,
        scrapeSucceeded: Boolean(scrapeResult),
      });

      const sessionDiag = {
        mode: 'dom_fallback',
        apiError: apiSession.error || '',
        bridgeTabId: bridgeTab.id,
        bridgeTabUrl: bridgeTab.url || '',
        domStatus: domResult.status,
        domDiagnostics: domResult.diagnostics || null,
        scrapeNotebookCount: Array.isArray(scrapeResult?.notebooks) ? scrapeResult.notebooks.length : 0,
        scrapeSucceeded: Boolean(scrapeResult),
        decisionValid: decision.valid,
        decisionReason: decision.reason || '',
        attempt,
      };

      if (decision.valid) {
        const valid = createValidSession();
        valid._diag = sessionDiag;
        await setNotebookSessionState(valid);
        return valid;
      }

      const invalid = createInvalidSession('LOGIN_REQUIRED');
      invalid._diag = sessionDiag;
      await setNotebookSessionState(invalid);
      return invalid;
    } catch (error) {
      const kind = classifySessionCheckError(normalizeError(error));
      if (shouldRetrySessionCheck(kind, attempt)) {
        continue;
      }

      const invalid = createInvalidSession('LOGIN_REQUIRED');
      invalid._diag = {
        bridgeError: normalizeError(error),
        errorKind: kind,
        attempt,
      };
      await setNotebookSessionState(invalid);
      return invalid;
    }
  }

  const invalid = createInvalidSession('LOGIN_REQUIRED');
  await setNotebookSessionState(invalid);
  return invalid;
}

async function tryCheckSessionViaApi() {
  try {
    const authSnapshot = await getNotebookAuthSnapshot();
    const request = buildListNotebooksRequest();
    await callNotebookRpc({
      fetchImpl: fetch,
      authSnapshot,
      rpcId: request.rpcId,
      paramsJson: request.paramsJson,
    });

    return { ok: true };
  } catch (error) {
    const message = normalizeError(error);
    // "definitive" means we are certain the user is not logged in.
    // Non-definitive failures (network, parsing) should fall through to DOM check.
    const definitive =
      message.includes('cookies are missing') ||
      message.includes('login expired') ||
      message.includes('accounts.google.com');
    return { ok: false, error: message, definitive };
  }
}

async function tryListNotebooksViaApi(_query) {
  try {
    const authSnapshot = await getNotebookAuthSnapshot();
    const request = buildListNotebooksRequest();
    const result = await callNotebookRpc({
      fetchImpl: fetch,
      authSnapshot,
      rpcId: request.rpcId,
      paramsJson: request.paramsJson,
    });

    const notebooksPayload = extractNotebookItemsFromRpc(result.payload);
    const notebooks = mapNotebookListPayload(notebooksPayload);
    return {
      ok: true,
      notebooks,
    };
  } catch (_error) {
    return { ok: false };
  }
}

async function tryCreateNotebookViaApi(name) {
  try {
    const authSnapshot = await getNotebookAuthSnapshot();
    const request = buildCreateNotebookRequest(name);
    const result = await callNotebookRpc({
      fetchImpl: fetch,
      authSnapshot,
      rpcId: request.rpcId,
      paramsJson: request.paramsJson,
    });

    const created = extractCreatedNotebookFromRpc(result.payload, name);
    if (!created) {
      return { ok: false, error: 'Could not extract created notebook from response' };
    }

    return {
      ok: true,
      notebook: created,
    };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

async function tryImportToNotebookViaApi(notebook, source) {
  try {
    const authSnapshot = await getNotebookAuthSnapshot();
    const request = buildImportSourceRequest(notebook.id, source.url);
    await callNotebookRpc({
      fetchImpl: fetch,
      authSnapshot,
      rpcId: request.rpcId,
      paramsJson: request.paramsJson,
      sourcePath: `/notebook/${notebook.id}`,
    });

    return { ok: true };
  } catch (_error) {
    return { ok: false };
  }
}

// Auth snapshot TTL: 10 minutes.
// Mirrors notebooklm-py: tokens are fetched fresh for each NotebookLMClient session,
// but within a session they are reused. We reuse within a 10-min window.
const AUTH_SNAPSHOT_TTL_MS = 10 * 60 * 1000;

async function getNotebookAuthSnapshot() {
  // Query only NotebookLM cookies.
  const [hostCookies, partitionedHostCookies] = await Promise.all([
    chrome.cookies.getAll({ url: NOTEBOOK_BASE_URL }),
    chrome.cookies.getAll({ url: NOTEBOOK_BASE_URL, partitionKey: {} }).catch(() => []),
  ]);

  // Merge cookies by name.
  const cookieMap = new Map();
  for (const cookie of [...hostCookies, ...partitionedHostCookies]) {
    cookieMap.set(cookie.name, cookie);
  }
  const cookies = Array.from(cookieMap.values());

  if (!hasRequiredCookieNames(cookies)) {
    throw new Error('NotebookLM cookies are missing. Please sign in to NotebookLM.');
  }

  // Return cached snapshot if it is still fresh.
  const cached = await getStoredAuthSnapshot();
  if (cached && Date.now() - cached.fetchedAt < AUTH_SNAPSHOT_TTL_MS) {
    return cached;
  }

  // Fetch the NotebookLM home page and extract CSRF token + session ID.
  // This mirrors notebooklm-py's fetch_tokens():
  //   - SNlM0e  -> CSRF token (csrf_token / at)
  //   - FdrFJe  -> session ID (session_id / fSid)
  // If the page redirects to accounts.google.com the user is logged out.
  const response = await fetch(NOTEBOOK_BASE_URL, {
    method: 'GET',
    credentials: 'include',
  });

  // Detect redirect to Google login (notebooklm-py: is_google_auth_redirect)
  if (!response.ok || response.url.includes('accounts.google.com')) {
    throw new Error('NotebookLM login expired. Please sign in again.');
  }

  const html = await response.text();
  const tokens = extractNotebookHtmlTokens(html);
  const snapshot = {
    at: tokens.at,
    bl: tokens.bl,
    fSid: tokens.fSid,
    fetchedAt: Date.now(),
  };

  await storeAuthSnapshot(snapshot);
  return snapshot;
}

async function getStoredAuthSnapshot() {
  const data = await chrome.storage.local.get([STORAGE_KEYS.authSnapshot]);
  const value = data[STORAGE_KEYS.authSnapshot];
  if (!value || typeof value !== 'object' || typeof value.fetchedAt !== 'number') {
    return null;
  }
  return value;
}

async function storeAuthSnapshot(snapshot) {
  await chrome.storage.local.set({ [STORAGE_KEYS.authSnapshot]: snapshot });
}

async function clearAuthSnapshot() {
  await chrome.storage.local.remove(STORAGE_KEYS.authSnapshot);
}

function extractNotebookItemsFromRpc(payload) {
  const wrb = Array.isArray(payload) ? payload.find(item => Array.isArray(item) && item[0] === 'wrb.fr') : null;

  if (!wrb) {
    return [];
  }

  let decoded = null;
  if (typeof wrb[2] === 'string') {
    try {
      decoded = JSON.parse(wrb[2]);
    } catch (_error) {
      decoded = null;
    }
  } else if (Array.isArray(wrb[2])) {
    decoded = wrb[2];
  }

  if (!Array.isArray(decoded)) {
    return [];
  }

  // NotebookLM may return either:
  // - [ [title, sources, notebookId, ...], ... ]
  // - [ [ [title, sources, notebookId, ...], ... ], ... ]
  if (Array.isArray(decoded[0]) && Array.isArray(decoded[0][0])) {
    return decoded[0];
  }

  return decoded;
}

function extractCreatedNotebookFromRpc(payload, fallbackTitle) {
  const wrb = Array.isArray(payload) ? payload.find(item => Array.isArray(item) && item[0] === 'wrb.fr') : null;

  if (wrb && typeof wrb[2] === 'string') {
    try {
      const decoded = JSON.parse(wrb[2]);
      // Create notebook (CCqFvf) returns notebook id at index 2.
      if (Array.isArray(decoded) && decoded.length >= 3 && decoded[2]) {
        const id = String(decoded[2]);
        return {
          id,
          title: fallbackTitle || 'Untitled notebook',
          url: `https://notebooklm.google.com/notebook/${encodeURIComponent(id)}`,
        };
      }
    } catch (_error) {
      // Fall through to list-style parsing.
    }
  }

  const notebooks = mapNotebookListPayload(extractNotebookItemsFromRpc(payload));
  if (!notebooks.length) {
    return null;
  }

  const exact = notebooks.find(item => item.title === fallbackTitle);
  if (exact) {
    return exact;
  }

  return notebooks[0];
}

async function ensureNotebookSession() {
  const sessionState = await checkNotebookSession(true);
  if (!sessionState.valid) {
    throw new Error('NotebookLM login expired. Please sign in again.');
  }
}

async function refreshSession() {
  await clearAuthSnapshot();
  const sessionState = await checkNotebookSession(true);
  return sessionState;
}

async function pushRecentNotebook(notebook) {
  const current = await getRecentNotebooks();
  const deduped = current.filter(item => item.id !== notebook.id);
  deduped.unshift({
    id: notebook.id,
    title: notebook.title,
    url: notebook.url,
    updatedAt: Date.now(),
  });

  await chrome.storage.local.set({
    [STORAGE_KEYS.recentNotebooks]: deduped.slice(0, 8),
  });
}

async function getActiveTabSource() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) {
    return {
      title: 'Untitled tab',
      url: '',
    };
  }

  return {
    title: tab.title || tab.url,
    url: tab.url,
  };
}

async function ensureNotebookBridgeTab() {
  const tabs = await chrome.tabs.query({ url: `${NOTEBOOK_BASE_URL}*` });

  let tab = tabs[0];
  if (!tab) {
    tab = await chrome.tabs.create({ url: NOTEBOOK_BASE_URL, active: false });
    await waitForTabComplete(tab.id);
  }

  await pingBridge(tab.id);
  return tab;
}

async function openNotebookInReusableTab(url) {
  const tabs = await chrome.tabs.query({ url: `${NOTEBOOK_BASE_URL}*` });
  let tab = tabs[0];
  if (!tab) {
    tab = await chrome.tabs.create({ url, active: false });
    await waitForTabComplete(tab.id);
    await pingBridge(tab.id);
    return tab;
  }

  await chrome.tabs.update(tab.id, { url, active: false });
  await waitForTabComplete(tab.id);
  await pingBridge(tab.id);
  return tab;
}

async function sendBridgeMessage(tabId, payload) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, payload);
    if (!response || !response.ok) {
      throw new Error(response?.error || 'Bridge response was invalid.');
    }
    return response.data;
  } catch (error) {
    throw new Error(`Could not communicate with NotebookLM bridge: ${normalizeError(error)}`);
  }
}

async function pingBridge(tabId) {
  const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
  if (!response?.ok) {
    throw new Error('NotebookLM bridge is unavailable.');
  }
}

function waitForTabComplete(tabId, timeout = 15000) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error('NotebookLM tab load timed out.'));
    }, timeout);

    function onUpdated(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId) {
        return;
      }
      if (changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

function normalizeError(error) {
  if (!error) {
    return 'Unknown error';
  }
  if (typeof error === 'string') {
    return error;
  }
  return error.message || 'Unknown error';
}
