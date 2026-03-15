export const SESSION_STATUS = {
  VALID: 'valid',
  INVALID: 'invalid',
};

export function createValidSession(now = Date.now()) {
  return {
    status: SESSION_STATUS.VALID,
    valid: true,
    lastCheckedAt: now,
    reason: '',
    _diag: null,
  };
}

export function createInvalidSession(reason, now = Date.now()) {
  return {
    status: SESSION_STATUS.INVALID,
    valid: false,
    lastCheckedAt: now,
    reason: reason || 'LOGIN_REQUIRED',
    _diag: null,
  };
}

export function getSessionStatusMessage(session) {
  if (session?.valid) {
    return 'NotebookLM session is active.';
  }

  return 'NotebookLM login expired. Please sign in again.';
}

export function isSessionExpired(session, now = Date.now(), maxAgeMs = 60000) {
  if (!session?.valid) {
    return true;
  }

  const lastCheckedAt = Number(session.lastCheckedAt || 0);
  return now - lastCheckedAt > maxAgeMs;
}
