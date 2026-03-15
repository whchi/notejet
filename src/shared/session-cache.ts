export const SESSION_CACHE_KEY = 'notejetNotebookSession';

export function readCachedSession(storage) {
  const raw = storage.getItem(SESSION_CACHE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed;
  } catch (_error) {
    return null;
  }
}

export function writeCachedSession(storage, session) {
  storage.setItem(SESSION_CACHE_KEY, JSON.stringify(session));
}

export function clearCachedSession(storage) {
  storage.removeItem(SESSION_CACHE_KEY);
}
