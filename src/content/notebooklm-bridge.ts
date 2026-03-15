chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleBridgeMessage(message)
    .then(data => sendResponse({ ok: true, data }))
    .catch(error => {
      sendResponse({ ok: false, error: formatError(error) });
    });

  return true;
});

async function handleBridgeMessage(message) {
  switch (message?.type) {
    case 'PING':
      return { ready: true };
    case 'SCRAPE_NOTEBOOKS':
      return scrapeNotebooks(message.query || '');
    case 'CHECK_LOGIN_DOM':
      return checkLoginDom();
    case 'CREATE_NOTEBOOK_DOM':
      return createNotebookDom(message.name || '');
    case 'IMPORT_SOURCE_DOM':
      return importSourceDom(message.source || {});
    default:
      throw new Error('Unsupported bridge message.');
  }
}

function scrapeNotebooks(query) {
  const lowerQuery = query.trim().toLowerCase();
  const links = Array.from(document.querySelectorAll('a[href*="/notebook/"]'));

  const seen = new Set();
  const notebooks = [];

  for (const link of links.slice(0, 50)) {
    const href = link.getAttribute('href') || '';
    const absolute = new URL(href, location.origin).toString();
    const id = extractNotebookId(absolute);

    // Extract just the title - NotebookLM URLs now format as: /notebook/{title},{uuid},{metadata}
    // The link text usually contains: "{title}, {metadata...}"
    // We need to extract just the title part
    let fullText = normalizeText(link.textContent || '');
    let title = fullText;

    // If text contains commas, likely has metadata - take only the first part
    if (fullText.includes(',')) {
      title = fullText.split(',')[0].trim();
    }

    // Also check for heading elements which might have cleaner text
    const heading = link.querySelector("h1, h2, h3, h4, [role='heading']");
    if (heading) {
      const headingText = normalizeText(heading.textContent);
      if (headingText && headingText.length > 0) {
        title = headingText;
      }
    }

    if (!id || seen.has(id)) {
      continue;
    }
    if (lowerQuery && !title.toLowerCase().includes(lowerQuery)) {
      continue;
    }

    seen.add(id);
    notebooks.push({ id, title, url: absolute });
  }

  return {
    notebooks: notebooks.slice(0, 50),
  };
}

function checkLoginDom() {
  const loginHints = ['Sign in', 'Log in', '登入', '登錄', 'Google Account'];
  const accountHints = ["[aria-label*='Account']", '[data-account]', "button[aria-haspopup='menu']"];

  const bodyText = normalizeText(document.body?.textContent || '').toLowerCase();
  const hasLoginHint = loginHints.some(item => bodyText.includes(item.toLowerCase()));
  const hasNotebookLink = Boolean(document.querySelector('a[href*="/notebook/"]'));
  const hasNotebookContainer = Boolean(document.querySelector("main, [role='main']"));
  const hasAccountUi = accountHints.some(selector => Boolean(document.querySelector(selector)));

  // --- DIAGNOSTIC: collect evidence at each selector ---
  const matchedAccountSelectors = accountHints.filter(selector => Boolean(document.querySelector(selector)));
  const matchedLoginHints = loginHints.filter(item => bodyText.includes(item.toLowerCase()));
  const allLinks = Array.from(document.querySelectorAll('a')).slice(0, 20);
  const linkSample = allLinks.map(a => ({
    href: (a.getAttribute('href') || '').slice(0, 80),
    text: normalizeText(a.textContent || '').slice(0, 40),
  }));
  const bodySnippet = bodyText.slice(0, 300);
  const diagnostics = {
    url: String(location.href),
    readyState: document.readyState,
    hasBody: Boolean(document.body),
    bodyLength: (document.body?.textContent || '').length,
    hasNotebookLink,
    hasNotebookContainer,
    hasAccountUi,
    hasLoginHint,
    matchedAccountSelectors,
    matchedLoginHints,
    linkSample,
    bodySnippet,
  };
  // --- END DIAGNOSTIC ---

  if (hasNotebookLink || hasAccountUi) {
    return { status: 'logged_in', diagnostics };
  }

  if (hasLoginHint && !hasNotebookContainer) {
    return { status: 'logged_out', diagnostics };
  }

  return { status: 'unknown', diagnostics };
}

async function createNotebookDom(name) {
  const allButtons = Array.from(document.querySelectorAll("button, [role='button']"));
  const buttonTexts = allButtons.map(b => b.textContent?.trim()).filter(Boolean);

  // Look for "New" button (NotebookLM updated to simpler text)
  const createButton = findButtonByText(['New', 'New notebook', 'Create notebook', 'Create', '新增', '新增筆記本']);

  if (!createButton) {
    return {
      created: false,
      error: 'Create button not found. Available buttons: ' + buttonTexts.slice(0, 10).join(', '),
    };
  }

  createButton.click();
  await delay(600);

  // Look for input - try multiple selectors
  const input =
    (document.querySelector('input[placeholder*="Notebook"]') as HTMLInputElement | null) ||
    (document.querySelector('input[placeholder*="notebook"]') as HTMLInputElement | null) ||
    (document.querySelector('input[placeholder*="Name"]') as HTMLInputElement | null) ||
    (document.querySelector('input[type="text"]') as HTMLInputElement | null) ||
    (document.querySelector('input') as HTMLInputElement | null);

  if (input) {
    input.focus();
    input.value = name;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  await delay(400);

  // Look for confirm button - try more variations
  const confirmButton = findButtonByText([
    'Create',
    'Create notebook',
    'New',
    '建立',
    '新增',
    '新增筆記本',
    'Save',
    'Save notebook',
  ]);
  if (confirmButton) {
    confirmButton.click();
  } else if (input) {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }

  await delay(2500);
  const createdNotebook = inferCurrentNotebook();

  if (!createdNotebook) {
    return { created: false, error: 'Could not detect created notebook after creation' };
  }

  return {
    created: true,
    notebook: createdNotebook,
  };
}

async function importSourceDom(source) {
  if (!source.url) {
    throw new Error('Source URL is required.');
  }

  const allButtons = Array.from(document.querySelectorAll("button, [role='button']"));
  const buttonTexts = allButtons.map(b => b.textContent?.trim()).filter(Boolean);

  // Look for "Sources" or "+" button (NotebookLM updated UI)
  const addSourceButton = findButtonByText([
    'Sources',
    '+',
    'Add source',
    'Add sources',
    'Add',
    '新增來源',
    '新增資料來源',
    '新增',
  ]);

  if (!addSourceButton) {
    return { imported: false, error: 'Add source button not found. Available: ' + buttonTexts.slice(0, 15).join(', ') };
  }

  addSourceButton.click();
  await delay(600);

  // Look for link/website option
  const linkButton = findButtonByText(['Website', 'Link', 'URL', '網頁', '連結', 'Add URL']);
  if (linkButton) {
    linkButton.click();
    await delay(500);
  }

  // Try multiple input selectors
  const input =
    (document.querySelector('input[type="url"]') as HTMLInputElement | null) ||
    (document.querySelector('input[placeholder*="https"]') as HTMLInputElement | null) ||
    (document.querySelector('input[placeholder*="URL"]') as HTMLInputElement | null) ||
    (document.querySelector('input[placeholder*="link"]') as HTMLInputElement | null) ||
    (document.querySelector('input') as HTMLInputElement | null) ||
    (document.querySelector('textarea') as HTMLTextAreaElement | null);

  if (!input) {
    return { imported: false, error: 'URL input not found' };
  }

  input.focus();
  input.value = source.url;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  await delay(400);

  // Try more confirm button variations
  const confirmButton = findButtonByText(['Add', 'Insert', 'Import', '新增', '匯入', 'Add source', 'Save', 'Submit']);
  if (confirmButton) {
    confirmButton.click();
  } else {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }

  await delay(1500);
  return {
    imported: true,
  };
}

function findButtonByText(candidates) {
  const elements = Array.from(document.querySelectorAll("button, [role='button']"));
  const wanted = candidates.map(item => item.toLowerCase());

  for (const element of elements) {
    const text = normalizeText(element.textContent || '').toLowerCase();
    if (!text) {
      continue;
    }
    if (wanted.some(item => text.includes(item))) {
      return element as HTMLElement;
    }
  }
  return null;
}

function inferCurrentNotebook() {
  const id = extractNotebookId(location.href);
  if (!id) {
    return null;
  }

  const heading = document.querySelector('h1') || document.querySelector('header h2');
  const title = normalizeText(heading?.textContent || 'Untitled notebook');

  return {
    id,
    title,
    url: location.href,
  };
}

function extractNotebookId(url) {
  // NotebookLM URLs format as: /notebook/{title},{uuid},{metadata}
  // Real notebook id is UUID in the second segment.
  const match = url.match(/\/notebook\/([^/?#]+)/i);
  if (!match) {
    return '';
  }

  const segments = match[1].split(',');
  if (segments.length >= 2) {
    return segments[1].trim();
  }

  const uuidMatch = match[1].match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return uuidMatch ? uuidMatch[0] : match[1];
}

function normalizeText(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatError(error) {
  if (!error) {
    return 'Unknown bridge error';
  }
  if (typeof error === 'string') {
    return error;
  }
  return error.message || 'Unknown bridge error';
}
