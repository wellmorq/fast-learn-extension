# Development Handoff

## Current Shape

Fast Learn is a no-build Chrome Manifest V3 extension. Chrome loads the source
files directly; there is no generated runtime output and no package manager is
required to develop or run the extension.

The main ownership boundaries are:

- `scripts/background.js`: context menus, page extraction, popup creation,
  settings initialization, and sync mirroring.
- `scripts/lookup_context.js`: isolated one-time context transfer from the
  background worker to a specific popup window.
- `popup/popup.js`: conversation and request lifecycle orchestration.
- `scripts/provider_requests.js`: Gemini and OpenAI-compatible request bodies.
- `scripts/streaming.js`: provider stream parsing, usage accounting, and
  normalization of structured or leading inline thinking into one UI contract.
- `popup/response_renderer.js`: Markdown sanitization and stable streaming DOM.
- `options/options.js`: provider, appearance, model, and preset editing UI.

Because there is no bundler, preserve the script order documented in
`README.md` when adding dependencies between files.

## Storage Ownership

- `chrome.storage.local` is the persistent source of truth for settings. API
  keys stay local and are never mirrored to sync storage.
- `chrome.storage.sync` is a best-effort mirror of safe settings and presets.
  Missing values may be restored from it, but existing local values win.
- `chrome.storage.session` holds a separately keyed lookup context and ownership
  entry for each popup. The popup consumes the context on first load; closing
  the window removes any context that was never consumed.
- Each popup copies its consumed context to its own `sessionStorage`, allowing
  that window to reload without exposing the text to other popup windows.

An archive or Git checkout does not include Chrome storage. A new developer
must configure their own provider and API key. Custom presets also need a
separate sanitized export if exact user configuration must be reproduced.

## Verification

Node.js 18 or newer is required for the standard checks:

```powershell
.\verification\verify.ps1
```

The script validates JavaScript syntax, runs every `verification/test_*.js`
smoke test, and parses `manifest.json`. Use `-Ui` to include the Playwright UI
smoke test after installing Python Playwright and Chromium.

The browser smoke test verifies that the `Thinking Process` node survives the
transition from reasoning to answer content, preserves manual scroll position,
and keeps answer Markdown outside the thinking block.

The Node streaming test also covers `<think>` tags split across SSE chunks, so
OpenAI-compatible providers using inline reasoning follow the same stable DOM
path as providers returning `reasoning_content`.

## Manual Acceptance

Before publishing a streaming UI change, check these cases in Chrome:

1. Start a request with long reasoning and confirm `Thinking Process`
   automatically follows the newest reasoning while already at the bottom.
2. Scroll upward with the wheel and confirm incoming reasoning does not force
   the container back to the bottom.
3. Use middle-button autoscroll while reasoning streams and while the answer
   begins; the interaction must remain attached and responsive.
4. Confirm the final answer appears below `Thinking Process`, without literal
   `<think>` tags or answer text inside the reasoning block.
5. Open two lookups quickly from different pages and confirm each popup receives
   its own selected text and source URL.
6. Edit a preset that references a model absent from the refreshed model list;
   saving unrelated fields must preserve that model.

## Refactor Direction

The current module split is sufficient for continued work. The next low-risk
cleanup targets are the broad UI owners in `options/options.js` and
`popup/popup.js`. Keep future extraction behavior-based: preset editing, model
loading, conversation history, and request lifecycle are useful boundaries.
Avoid introducing a framework or build system unless a concrete feature needs
one.
