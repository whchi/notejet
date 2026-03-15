import {
  DEFAULT_IMPORT_SOURCE_POLICY,
  normalizeImportSourcePolicy,
  parseWhitelistInput,
  validateWhitelistEntry,
} from '../shared/source-url-policy.js';

const whitelistTagsEl = document.getElementById('whitelistTags') as HTMLElement;
const whitelistEntryInputEl = document.getElementById('whitelistEntryInput') as HTMLInputElement;
const saveButtonEl = document.getElementById('saveButton') as HTMLButtonElement;
const resetButtonEl = document.getElementById('resetButton') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLElement;
const entryHelpEl = document.getElementById('entryHelp') as HTMLElement;

const state = {
  whitelist: [],
  duplicateEntry: '',
};

void bootstrap();

saveButtonEl.addEventListener('click', () => void handleSave());
resetButtonEl.addEventListener('click', () => void handleReset());
whitelistEntryInputEl.addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ',') {
    return;
  }
  event.preventDefault();
  addEntriesFromInput();
});
whitelistEntryInputEl.addEventListener('blur', () => {
  addEntriesFromInput();
});
whitelistEntryInputEl.addEventListener('input', () => {
  validateCurrentEntry();
});

async function bootstrap() {
  setStatus('Loading...');
  try {
    const policy = await sendMessage({ type: 'GET_IMPORT_SOURCE_POLICY' });
    state.whitelist = [...normalizeImportSourcePolicy(policy).whitelist];
    renderWhitelistTags();
    setStatus('Ready.', 'success');
  } catch (error) {
    setStatus(String(error), 'error');
  }
}

async function handleSave() {
  addEntriesFromInput();
  if (!state.whitelist.length) {
    setStatus('Whitelist cannot be empty.', 'error');
    return;
  }

  setBusy(true);
  try {
    const saved = await sendMessage({
      type: 'SET_IMPORT_SOURCE_POLICY',
      policy: { whitelist: state.whitelist },
    });
    state.whitelist = [...normalizeImportSourcePolicy(saved).whitelist];
    renderWhitelistTags();
    setStatus('Saved.', 'success');
  } catch (error) {
    setStatus(String(error), 'error');
  } finally {
    setBusy(false);
  }
}

async function handleReset() {
  setBusy(true);
  try {
    const saved = await sendMessage({
      type: 'SET_IMPORT_SOURCE_POLICY',
      policy: DEFAULT_IMPORT_SOURCE_POLICY,
    });
    state.whitelist = [...normalizeImportSourcePolicy(saved).whitelist];
    renderWhitelistTags();
    setStatus('Reset to default.', 'success');
  } catch (error) {
    setStatus(String(error), 'error');
  } finally {
    setBusy(false);
  }
}

function setBusy(busy) {
  saveButtonEl.disabled = busy;
  resetButtonEl.disabled = busy;
  whitelistEntryInputEl.disabled = busy;
}

function addEntriesFromInput() {
  const entries = parseWhitelistInput(whitelistEntryInputEl.value);
  if (!entries.length) {
    whitelistEntryInputEl.value = '';
    clearEntryHelp();
    return;
  }

  const accepted = [];
  for (const entry of entries) {
    const validation = validateWhitelistEntry(entry);
    if (!validation.valid) {
      setEntryHelp(validation.reason, 'error');
      whitelistEntryInputEl.classList.add('invalid');
      continue;
    }

    if (state.whitelist.includes(validation.normalized)) {
      state.duplicateEntry = validation.normalized;
      continue;
    }

    accepted.push(validation.normalized);
  }

  if (accepted.length) {
    state.whitelist = dedupe([...state.whitelist, ...accepted]);
    clearEntryHelp();
    whitelistEntryInputEl.classList.remove('invalid');
  } else if (!entryHelpEl.textContent) {
    setEntryHelp('No new valid entries were added.', 'error');
    whitelistEntryInputEl.classList.add('invalid');
  }

  whitelistEntryInputEl.value = '';
  renderWhitelistTags();
}

function removeWhitelistEntry(entry) {
  state.whitelist = state.whitelist.filter(item => item !== entry);
  renderWhitelistTags();
}

function renderWhitelistTags() {
  whitelistTagsEl.innerHTML = '';

  if (!state.whitelist.length) {
    const empty = document.createElement('p');
    empty.className = 'tags-empty';
    empty.textContent = 'No entries. Add at least one host pattern.';
    whitelistTagsEl.appendChild(empty);
    return;
  }

  for (const entry of state.whitelist) {
    const chip = document.createElement('span');
    chip.className = 'tag';
    if (state.duplicateEntry === entry) {
      chip.classList.add('duplicate');
      setTimeout(() => {
        state.duplicateEntry = '';
        renderWhitelistTags();
      }, 550);
    }

    const text = document.createElement('span');
    text.textContent = entry;

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.setAttribute('aria-label', `Remove ${entry}`);
    removeButton.textContent = 'x';
    removeButton.addEventListener('click', () => {
      removeWhitelistEntry(entry);
    });

    chip.appendChild(text);
    chip.appendChild(removeButton);
    whitelistTagsEl.appendChild(chip);
  }
}

function validateCurrentEntry() {
  const raw = whitelistEntryInputEl.value.trim();
  if (!raw) {
    clearEntryHelp();
    whitelistEntryInputEl.classList.remove('invalid');
    return;
  }

  const firstToken = parseWhitelistInput(raw)[0] || raw;
  const validation = validateWhitelistEntry(firstToken);
  if (!validation.valid) {
    setEntryHelp(validation.reason, 'error');
    whitelistEntryInputEl.classList.add('invalid');
    return;
  }

  whitelistEntryInputEl.classList.remove('invalid');
  setEntryHelp('Looks good. Press Enter to add.');
}

function clearEntryHelp() {
  entryHelpEl.textContent = '';
  entryHelpEl.classList.remove('error');
}

function setEntryHelp(message, type = '') {
  entryHelpEl.textContent = message;
  entryHelpEl.classList.remove('error');
  if (type) {
    entryHelpEl.classList.add(type);
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

function dedupe(list) {
  return Array.from(new Set(list));
}
