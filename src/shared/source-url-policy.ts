export const DEFAULT_IMPORT_SOURCE_POLICY = {
  whitelist: ['*'],
};

export function normalizeImportSourcePolicy(value) {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_IMPORT_SOURCE_POLICY };
  }

  const list = Array.isArray(value.whitelist) ? value.whitelist : [];
  const whitelist = dedupe(
    list
      .map(item =>
        String(item || '')
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean),
  );

  if (!whitelist.length) {
    return { ...DEFAULT_IMPORT_SOURCE_POLICY };
  }

  return { whitelist };
}

export function validateImportSourceUrl(rawUrl, policyInput) {
  const policy = normalizeImportSourcePolicy(policyInput);
  const urlText = String(rawUrl || '').trim();

  if (!urlText) {
    return {
      valid: false,
      reason: 'No source URL detected in active tab.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(urlText);
  } catch (_error) {
    return {
      valid: false,
      reason: 'Source URL is invalid.',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      reason: 'Only HTTP/HTTPS pages can be imported.',
    };
  }

  const allowed = policy.whitelist.some(entry => matchesWhitelist(parsed, entry));
  if (!allowed) {
    return {
      valid: false,
      reason: 'Source URL is not allowed by whitelist.',
    };
  }

  return {
    valid: true,
    reason: '',
  };
}

export function parseWhitelistInput(text) {
  const entries = String(text || '')
    .split(/[\n,]/)
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);

  return dedupe(entries);
}

export function validateWhitelistEntry(rawEntry) {
  const entry = String(rawEntry || '')
    .trim()
    .toLowerCase();
  if (!entry) {
    return {
      valid: false,
      normalized: '',
      reason: 'Entry is empty.',
    };
  }

  if (entry === '*') {
    return {
      valid: true,
      normalized: '*',
      reason: '',
    };
  }

  if (entry.includes('://')) {
    return validateUrlEntry(entry);
  }

  if (!isValidHostPattern(entry)) {
    return {
      valid: false,
      normalized: '',
      reason: 'Invalid host pattern. Use example.com or *.example.com',
    };
  }

  return {
    valid: true,
    normalized: entry,
    reason: '',
  };
}

function matchesWhitelist(url, entry) {
  if (entry === '*') {
    return true;
  }

  if (entry.includes('://')) {
    try {
      const allowed = new URL(entry);
      if (allowed.protocol !== url.protocol) {
        return false;
      }
      return matchesHost(url.hostname, allowed.hostname);
    } catch (_error) {
      return false;
    }
  }

  return matchesHost(url.hostname, entry);
}

function matchesHost(hostname, pattern) {
  const host = String(hostname || '').toLowerCase();
  const target = String(pattern || '').toLowerCase();

  if (target === '*') {
    return true;
  }

  if (target.startsWith('*.')) {
    const suffix = target.slice(2);
    return host === suffix || host.endsWith(`.${suffix}`);
  }

  return host === target;
}

function dedupe(values) {
  return Array.from(new Set(values));
}

function validateUrlEntry(entry) {
  let parsed: URL;
  try {
    parsed = new URL(entry);
  } catch (_error) {
    return {
      valid: false,
      normalized: '',
      reason: 'Invalid URL entry.',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      normalized: '',
      reason: 'Whitelist URL entry must use http or https.',
    };
  }

  if (!parsed.hostname || !isValidHostPattern(parsed.hostname)) {
    return {
      valid: false,
      normalized: '',
      reason: 'Whitelist URL entry has invalid hostname.',
    };
  }

  if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
    return {
      valid: false,
      normalized: '',
      reason: 'Whitelist URL entry should only include scheme and host.',
    };
  }

  return {
    valid: true,
    normalized: `${parsed.protocol}//${parsed.hostname}`,
    reason: '',
  };
}

function isValidHostPattern(value) {
  if (value === '*') {
    return true;
  }

  if (value.startsWith('*.')) {
    return isValidHostname(value.slice(2));
  }

  return isValidHostname(value);
}

function isValidHostname(hostname) {
  if (!hostname || hostname.length > 253) {
    return false;
  }

  const labels = hostname.split('.');
  if (labels.some(label => !label)) {
    return false;
  }

  const labelPattern = /^[a-z0-9-]{1,63}$/;
  return labels.every(label => {
    if (!labelPattern.test(label)) {
      return false;
    }
    if (label.startsWith('-') || label.endsWith('-')) {
      return false;
    }
    return true;
  });
}
