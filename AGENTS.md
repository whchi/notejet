# AGENTS.md

This file gives coding agents repo-specific guidance for working in `notejet`.

## Project Snapshot

- App type: side-loaded Chrome extension prototype.
- Runtime: Manifest V3 extension with module service worker.
- Language: TypeScript (ES2022 target, ES modules).
- Build output: `dist/` folder (load unpacked from `dist/`, not project root).
- Main entry points:
  - `manifest.json`
  - `src/background/service-worker.ts`
  - `src/content/notebooklm-bridge.ts`
  - `src/popup/popup.ts`, `src/popup/popup.html`, `src/popup/popup.css`
  - `src/options/options.ts`, `src/options/options.html`, `src/options/options.css`
  - `src/shared/` - shared modules (API client, auth, session, URL policy)
- Purpose: capture the active tab URL and hand it off into NotebookLM.
- State is local only; no backend.

## Instruction Files Present

- Root `AGENTS.md`: this file.
- Cursor rules: none found.
- Copilot instructions: none found.

## Build, Run, Lint, and Test Commands

### Build

```bash
npm run build          # Clean + TypeScript compile + copy assets to dist/
npm run clean          # Remove dist/
npm run build:ts       # TypeScript compile only
npm run build:assets   # Copy static assets only
```

- Extension runs from compiled output in `dist/`.
- After code changes: rebuild + reload extension in Chrome.

### Load Extension

1. Run `npm run build`
2. Open `chrome://extensions`
3. Enable Developer mode
4. Click "Load unpacked"
5. Select the `dist/` folder (not project root)
6. After changes: rebuild, then click Reload on extension card

### Lint / Format

```bash
npm run format:fix     # Format with Biome (writes in place)
```

- No ESLint or TypeScript strict mode currently configured.
- Preserve existing formatting style. Code uses no semicolons.

### Test

```bash
npm test                    # Build + run all tests
node --test tests/session-state.test.mjs    # Run single test file
node --test                  # Run all tests without rebuilding
```

- Tests are `.mjs` files in `tests/`.
- Tests import from `dist/src/...` (built output), so build first.
- No e2e harness; test checklist is manual.

## Architecture

```
src/
├── background/service-worker.ts   # Orchestration, storage, tabs, message routing
├── content/notebooklm-bridge.ts    # NotebookLM DOM automation (fallback)
├── popup/                          # UI for capture/import
├── options/                        # Import whitelist configuration
├── shared/                         # Shared logic (API, auth, session, policy)
└── types/chrome.d.ts              # Chrome extension type declarations
```

### Message Flow

- Popup sends messages to background via `chrome.runtime.sendMessage`.
- Background routes to content script via `chrome.tabs.sendMessage`.
- All cross-context messages use `{ ok: true, data }` or `{ ok: false, error }` envelope.

### Storage Keys

- `recentNotebooks` - array of recent notebook metadata
- `notebookSession` - login session state
- `authSnapshot` - cached NotebookLM auth tokens
- `importSourcePolicy` - URL whitelist for imports

## TypeScript Style

- Target: ES2022, modules ES2022.
- `strict: false` in tsconfig - gradual typing.
- No semicolons in source files.
- Double-quoted strings for literals.
- Template literals for interpolated strings.
- ES module imports with `.js` extension: `import { foo } from './bar.js';`
- `const` by default; `let` only when reassignment needed.
- `async function name()` over arrow functions for top-level.
- Arrow functions for inline callbacks: `items.map(item => item.id)`.

### Naming Conventions

- Constants: `UPPER_SNAKE_CASE` (e.g., `STORAGE_KEYS`, `NOTEBOOK_BASE_URL`).
- Functions: `camelCase`, action-oriented (e.g., `getBootstrap`, `importToNotebook`).
- DOM elements: `camelCase` + `El` suffix (e.g., `statusEl`, `searchInputEl`).
- Data objects: nouns (e.g., `source`, `notebook`, `response`).
- Message types: upper snake case strings (e.g., `'GET_BOOTSTRAP'`, `'IMPORT_SOURCE_DOM'`).
- Private-ish functions: no prefix, just file-scoped.

### Types

- Most functions lack explicit return types (gradual typing).
- Parameters often lack explicit types.
- Interface definitions are minimal; prefer object literals.
- Type assertions via `as` for DOM elements: `document.getElementById('id') as HTMLInputElement`.

## Error Handling

- Throw `Error` with user-readable messages: `throw new Error('Notebook name is required.')`.
- Normalize errors at boundaries: `normalizeError(error)` in background, `formatError()` in content script.
- Preserve `{ ok: true, data }` / `{ ok: false, error }` envelope in runtime messaging.
- Surface actionable fallback guidance when automation fails.
- Early validation: fail fast on missing IDs or URLs.

## State Management

- Popup: mutable UI state in local `state` object; update state first, then render.
- Background: persistence via `chrome.storage.local`.
- Avoid storing transient UI state in storage unless persistence required.
- Clear invalid selections explicitly after data refresh.

## NotebookLM Automation

- API-first approach: try NotebookLM internal RPC before DOM automation.
- DOM automation is fragile; prefer additive, resilient matching.
- Short async delays between UI steps.
- On uncertain failure: return clean failure state, leave NotebookLM page open for manual completion.

## When Making Changes

- Read the relevant file fully before editing.
- Match surrounding formatting exactly.
- Prefer surgical edits over broad refactors.
- Build and reload extension before validating.
- Update README.md if behavior or permissions change.
- Run `npm test` if touching shared modules.

## Done Criteria

- Extension loads as unpacked MV3 from `dist/`.
- `npm run build` succeeds with no errors.
- `npm test` passes.
- Manual validation of affected workflow.
- README updated for user-facing changes.