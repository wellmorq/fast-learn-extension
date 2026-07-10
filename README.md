# Fast Learn

A Chrome extension for analyzing and explaining web content using Google Gemini or OpenAI-compatible providers such as GLM/Z.AI and OpenRouter.

## Features

- Analyze selected text or entire web pages
- Multiple preset prompts for different analysis styles
- Customizable temperature and thinking budget settings
- Follow-up conversations with context retention
- Google Gemini and OpenAI-compatible provider support
- Multiple UI themes

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/wellmorq/fast-learn-extension.git
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable "Developer mode" (toggle in top right)

4. Click "Load unpacked" and select the cloned repository folder

5. Configure your provider and API key in the extension options

There is no build step. Edit the source files and reload the unpacked extension
from `chrome://extensions/`.

## Getting API Key

For Google Gemini, get your API key at [Google AI Studio](https://aistudio.google.com/app/apikey).

For OpenAI-compatible providers, use the provider's Base URL and API key. The extension defaults are tuned for GLM/Z.AI.

## Usage

1. Select text on any webpage or right-click for page analysis
2. Choose "Explain" from context menu and select a preset
3. View AI-generated analysis in popup window
4. Ask follow-up questions to continue the conversation

Alternative: Use keyboard shortcut `Ctrl+Shift+Q` (Windows/Linux) or `Cmd+Shift+Q` (Mac)

## Development

The extension uses plain JavaScript, HTML, and CSS. Runtime dependencies are
vendored in `libs/`; `package.json` is intentionally not required.

Script load order is part of the runtime contract:

- Popup: `settings.js`, `utils.js`, `lookup_context.js`,
  `provider_requests.js`, `streaming.js`, `response_renderer.js`, `popup.js`
- Options: `settings.js`, `utils.js`, `options.js`
- Background worker: `settings.js`, `utils.js`, `lookup_context.js`,
  `background.js`

Run the static and Node smoke checks with Node.js 18 or newer:

```powershell
.\verification\verify.ps1
```

The optional browser UI smoke test also requires Python and Playwright:

```powershell
python -m pip install playwright
python -m playwright install chromium
.\verification\verify.ps1 -Ui
```

See [HANDOFF.md](HANDOFF.md) for architecture, storage ownership, manual test
cases, and transfer notes.

## License

MIT License - Use at your own risk

