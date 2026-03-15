export const LOGIN_STATUS = {
  LOGGED_IN: 'logged_in',
  LOGGED_OUT: 'logged_out',
  UNKNOWN: 'unknown',
};

export function decideSessionFromChecks({ domStatus, notebooksCount, scrapeSucceeded }) {
  if (domStatus === LOGIN_STATUS.LOGGED_IN) {
    return { valid: true, reason: 'DOM_LOGGED_IN' };
  }

  if (Number(notebooksCount) > 0) {
    return { valid: true, reason: 'SCRAPE_FOUND_NOTEBOOKS' };
  }

  if (domStatus === LOGIN_STATUS.UNKNOWN && scrapeSucceeded) {
    return { valid: true, reason: 'SCRAPE_SUCCESS_FALLBACK' };
  }

  return { valid: false, reason: 'LOGIN_REQUIRED' };
}

export function classifySessionCheckError(message) {
  const normalized = String(message || '').toLowerCase();

  if (normalized.includes('bridge is unavailable')) {
    return 'bridge_unavailable';
  }

  if (normalized.includes('timed out') || normalized.includes('timeout')) {
    return 'bridge_timeout';
  }

  return 'unknown';
}

export function shouldRetrySessionCheck(errorKind, attempt) {
  if (attempt >= 1) {
    return false;
  }

  return errorKind === 'bridge_unavailable' || errorKind === 'bridge_timeout';
}
