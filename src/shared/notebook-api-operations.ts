const NOTEBOOK_BASE_URL = 'https://notebooklm.google.com';

export function buildListNotebooksRequest() {
  return {
    rpcId: 'wXbhsf',
    paramsJson: JSON.stringify([null, 1, null, [2]]),
  };
}

export function buildCreateNotebookRequest(name) {
  return {
    rpcId: 'CCqFvf',
    paramsJson: JSON.stringify([
      String(name || ''),
      null,
      null,
      [2],
      [1, null, null, null, null, null, null, null, null, null, [1]],
    ]),
  };
}

export function buildImportSourceRequest(notebookId, sourceUrl) {
  const normalizedUrl = String(sourceUrl || '');
  const isYouTube = /youtube\.com|youtu\.be/i.test(normalizedUrl);
  const sourceData = isYouTube
    ? [null, null, null, null, null, null, null, [normalizedUrl], null, null, 1]
    : [null, null, [normalizedUrl], null, null, null, null, null, null, null, 1];

  return {
    rpcId: 'izAoDd',
    paramsJson: JSON.stringify([
      [sourceData],
      String(notebookId || ''),
      [2],
      [1, null, null, null, null, null, null, null, null, null, [1]],
    ]),
  };
}

export function mapNotebookListPayload(payload) {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map(item => {
      if (!Array.isArray(item) || !item[2]) {
        return null;
      }

      const id = String(item[2]);
      const title = String(item[0] || 'Untitled notebook');

      return {
        id,
        title,
        url: buildNotebookUrl(id),
      };
    })
    .filter(Boolean);
}

export function buildNotebookUrl(notebookId) {
  return `${NOTEBOOK_BASE_URL}/notebook/${encodeURIComponent(String(notebookId || ''))}`;
}

export function filterNotebooksByQuery(notebooks, query) {
  if (!Array.isArray(notebooks)) {
    return [];
  }

  const normalizedQuery = String(query || '')
    .trim()
    .toLowerCase();
  if (!normalizedQuery) {
    return notebooks;
  }

  return notebooks.filter(notebook => {
    const title = String(notebook?.title || '').toLowerCase();
    return title.includes(normalizedQuery);
  });
}
