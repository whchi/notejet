// Minimum required cookies to attempt NotebookLM auth.
// Modern Chrome uses __Secure-1PSID instead of SID due to privacy sandbox/CHIPS.
// Accept any of these as valid session indicators.
const MINIMUM_REQUIRED_COOKIES = ['SID', '__Secure-1PSID', '__Secure-3PSID'];

export function getRequiredCookieNames() {
  return [...MINIMUM_REQUIRED_COOKIES];
}

export function hasRequiredCookieNames(cookies) {
  const names = new Set((cookies || []).map(cookie => cookie?.name).filter(Boolean));
  // Need at least one of the required cookies (SID or its secure variants)
  return MINIMUM_REQUIRED_COOKIES.some(name => names.has(name));
}

export function extractNotebookHtmlTokens(html) {
  const at = matchToken(html, /"SNlM0e":"([^\"]+)"/);
  const bl = matchToken(html, /"cfb2h":"([^\"]+)"/);
  const fSid = matchToken(html, /"FdrFJe":"([^\"]+)"/);

  return { at, bl, fSid };
}

function matchToken(html, pattern) {
  const match = String(html || '').match(pattern);
  if (!match) {
    throw new Error('Missing NotebookLM token.');
  }
  return match[1];
}
