export function buildSessionGate(sessionState) {
  if (!sessionState?.valid) {
    return {
      canSearch: false,
      canCreate: false,
      canImport: false,
      statusMessage: 'NotebookLM login expired. Please sign in again.',
    };
  }

  return {
    canSearch: true,
    canCreate: true,
    canImport: true,
    statusMessage: 'Ready.',
  };
}

export function getSessionActionLabel(sessionState) {
  return sessionState?.valid ? 'Open notebook' : 'Sign in to NotebookLM';
}
