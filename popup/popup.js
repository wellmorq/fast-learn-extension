let messages = [];
let currentSettings = {};
let isProcessing = false;
let contextPreset = null;
let currentFollowupPreset = null;
let followupPresetOriginalValues = {};

// === New state ===
// Snapshot of what was sent to the popup at open time. Used to (a) re-fire
// the initial query when the user switches the context preset, and (b)
// resolve {{selectedText}} / {{pageUrl}} / {{pageTitle}} in system prompts.
let initialContext = { text: '', isPageContent: false, sourceUrl: '', sourceTitle: '' };
// AbortController of the in-flight fetch — populated before each request.
let currentAbortController = null;
// Monotonic request counter. Each request captures its value; stale callbacks
// (e.g. the aborted request when the user switches preset mid-stream) compare
// against the global and bail out so they can't clobber the newer request.
let requestSeq = 0;
// Markdown source of the last completed response (for the Copy button).
let lastResponseMarkdown = '';
// Markdown of the currently-streaming response (so Copy works mid-stream too,
// and so partial text is preserved on Stop).
let currentStreamingMarkdown = '';
// performance.now() timestamp of last fetch start, used for usage footer duration.
let lastRequestStartedAt = 0;

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await initializePopup();
    } catch (error) {
        console.error('Initialization error:', error);
        showError('Extension initialization error');
    }
});

async function initializePopup() {
    await loadSettings();
    applyFontSettings();

    const stored = await chrome.storage.local.get(['selectedText', 'isPageContent', 'selectedPresetId', 'sourceUrl', 'sourceTitle']);
    const { selectedText, isPageContent, selectedPresetId, sourceUrl, sourceTitle } = stored;

    if (!selectedText) {
        showError('No text to process');
        return;
    }

    initialContext = {
        text: selectedText,
        isPageContent: !!isPageContent,
        sourceUrl: sourceUrl || '',
        sourceTitle: sourceTitle || ''
    };

    if (selectedPresetId) {
        currentSettings.selectedPresetId = selectedPresetId;
    }

    await loadModels();
    await loadPresets();
    displayTextPreview(selectedText, isPageContent);
    setupEventListeners();
    await sendToAI(selectedText, false);
}

async function loadSettings() {
    const settings = await chrome.storage.local.get([
        'apiProvider',
        'apiKey',
        'openaiBaseUrl',
        'openaiApiKey',
        'defaultModel',
        'defaultContextPresetId',
        'defaultFollowupPresetId',
        'fontSize',
        'fontFamily',
        'colorTheme',
        'contextPresets',
        'followupPresets'
    ]);

    currentSettings = {
        apiProvider: settings.apiProvider || 'google',
        apiKey: settings.apiKey || '',
        openaiBaseUrl: settings.openaiBaseUrl || 'https://openrouter.ai/api/v1',
        openaiApiKey: settings.openaiApiKey || '',
        defaultModel: settings.defaultModel || 'glm-5.1',
        model: settings.defaultModel || 'glm-5.1',
        fontSize: settings.fontSize || '16px',
        fontFamily: settings.fontFamily || 'Roboto',
        colorTheme: settings.colorTheme || 'soft-gray',
        defaultContextPresetId: settings.defaultContextPresetId || null,
        defaultFollowupPresetId: settings.defaultFollowupPresetId || null,
        contextPresets: settings.contextPresets || [],
        followupPresets: settings.followupPresets || []
    };
}

function applyFontSettings() {
    document.documentElement.style.setProperty('--base-font-size', currentSettings.fontSize);
    document.documentElement.style.setProperty('--font-family', currentSettings.fontFamily);
    document.documentElement.setAttribute('data-theme', currentSettings.colorTheme);
}

async function loadPresets() {
    await loadFollowupPresets();
    await loadContextPreset();
}

async function loadContextPreset() {
    const { selectedPresetId } = await chrome.storage.local.get('selectedPresetId');
    const contextSelect = document.getElementById('context-preset-select');
    contextSelect.innerHTML = '';

    if (!currentSettings.contextPresets || currentSettings.contextPresets.length === 0) {
        contextSelect.innerHTML = '<option value="">No context presets</option>';
        console.warn('No context presets found');
        return;
    }

    let preset = null;
    if (selectedPresetId) {
        preset = currentSettings.contextPresets.find(p => p.id === selectedPresetId);
        currentSettings.selectedPresetId = selectedPresetId;
    }
    if (!preset) {
        preset = currentSettings.contextPresets.find(p =>
            p.id === currentSettings.defaultContextPresetId || p.isDefault
        ) || currentSettings.contextPresets[0];
    }

    currentSettings.contextPresets.forEach(p => {
        const option = document.createElement('option');
        option.value = p.id;
        option.textContent = p.name;
        if (preset && p.id === preset.id) option.selected = true;
        contextSelect.appendChild(option);
    });

    if (preset) {
        contextPreset = preset;
    }

    if (selectedPresetId) {
        await chrome.storage.local.remove('selectedPresetId');
    }
}

async function loadFollowupPresets() {
    const followupSelect = document.getElementById('followup-preset-select');
    followupSelect.innerHTML = '';

    if (!currentSettings.followupPresets || currentSettings.followupPresets.length === 0) {
        followupSelect.innerHTML = '<option value="">No follow-up presets</option>';
        showError('No follow-up presets found. Please go to extension settings.');
        return;
    }

    currentSettings.followupPresets.forEach(preset => {
        followupPresetOriginalValues[preset.id] = {
            temperature: preset.temperature,
            thinkingBudget: preset.thinkingBudget,
            model: preset.model
        };
    });

    let defaultPreset = currentSettings.followupPresets.find(p =>
        p.id === currentSettings.defaultFollowupPresetId || p.isDefault
    ) || currentSettings.followupPresets[0];

    currentSettings.followupPresets.forEach(preset => {
        const option = document.createElement('option');
        option.value = preset.id;
        option.textContent = preset.name;

        if (preset.id === defaultPreset.id) {
            option.selected = true;
        }

        followupSelect.appendChild(option);
    });

    if (defaultPreset) {
        applyFollowupPreset(defaultPreset);
    }
}

function applyFollowupPreset(preset) {
    currentFollowupPreset = preset;

    currentSettings.model = preset.model || currentSettings.defaultModel;
    const modelSelect = document.getElementById('model-select');
    if (modelSelect) {
        // If the preset references a model not in the current list, add it so it
        // can actually be selected rather than falling back to the first entry.
        if (currentSettings.model &&
            ![...modelSelect.options].some(o => o.value === currentSettings.model)) {
            const opt = document.createElement('option');
            opt.value = currentSettings.model;
            opt.textContent = stripModelPrefix(currentSettings.model);
            modelSelect.appendChild(opt);
        }
        modelSelect.value = currentSettings.model;
        if (modelSelect.selectedIndex === -1 && modelSelect.options.length > 0) {
            modelSelect.selectedIndex = 0;
            currentSettings.model = modelSelect.value;
        }
    }

    const originalValues = followupPresetOriginalValues[preset.id];
    if (originalValues) {
        const tempSlider = document.getElementById('temp-slider');
        const tempValue = document.getElementById('temp-value');
        const budgetInput = document.getElementById('budget-input');

        if (tempSlider && tempValue) {
            tempSlider.value = originalValues.temperature;
            tempValue.textContent = originalValues.temperature.toFixed(1);
        }

        if (budgetInput) {
            budgetInput.value = originalValues.thinkingBudget;
        }
    }
}

async function loadModels() {
    const provider = currentSettings.apiProvider;
    const { cachedModels, cachedModelsProvider } = await chrome.storage.local.get(['cachedModels', 'cachedModelsProvider']);

    // Only trust the cache if it belongs to the active provider (older caches
    // had no provider tag — treat those as usable to avoid a forced refresh).
    const cacheUsable = cachedModels && cachedModels.length > 0 &&
        (!cachedModelsProvider || cachedModelsProvider === provider);

    if (cacheUsable) {
        populateModelSelect(cachedModels);
    } else {
        populateModelSelect(getFallbackModels(provider, currentSettings.defaultModel));
    }
}

function populateModelSelect(models) {
    const modelSelect = document.getElementById('model-select');
    modelSelect.innerHTML = '';

    // Make sure the currently desired model is always present as an option, so
    // a configured GLM model is never silently swapped for the first Gemini
    // entry (and vice-versa).
    const list = models.slice();
    const desired = currentSettings.model;
    if (desired && !list.some(m => m === desired || stripModelPrefix(m) === stripModelPrefix(desired))) {
        list.unshift(desired);
    }

    let isSelected = false;

    list.forEach(model => {
        const option = document.createElement('option');
        const displayName = stripModelPrefix(model);
        option.value = model;
        option.textContent = displayName;
        if (model === currentSettings.model || displayName === currentSettings.model) {
            option.selected = true;
            isSelected = true;
        }
        modelSelect.appendChild(option);
    });

    if (!isSelected && list.length > 0) {
        modelSelect.selectedIndex = 0;
        currentSettings.model = list[0];
    }
}

// Estimate of what will actually be sent on the FIRST request (text + the
// resolved context preset's system prompt). Updated whenever the user
// switches context preset. Closer to the real `↑ N` reported by the API
// than counting the raw selection alone.
function estimatePreviewTokens(text) {
    let combined = text || '';
    if (contextPreset && contextPreset.systemPrompt) {
        const resolved = applyPromptVariables(contextPreset.systemPrompt, getPromptContext());
        combined += '\n' + (resolved || '');
    }
    return estimateTokenCount(combined);
}

function displayTextPreview(text, isPageContent) {
    const preview = document.getElementById('text-preview');
    const maxLength = 150;

    preview.dataset.fullText = text;
    preview.dataset.isPageContent = isPageContent;

    let displayText = text;
    if (text.length > maxLength) {
        displayText = text.substring(0, maxLength) + '...';
    }

    const estimatedTokens = estimatePreviewTokens(text);
    const tokenInfo = `<span class="token-count" title="Оценка для запроса: текст выделения + system prompt пресета. Реальное число от API см. в ↑ под ответом.">~${estimatedTokens} токенов</span>`;

    if (isPageContent) {
        const presetName = contextPreset ? ` (${contextPreset.name})` : '';
        preview.innerHTML = `<strong>📄 Full page content${presetName} ${tokenInfo}</strong><br>${escapeHtml(displayText)}`;
    } else {
        const presetName = contextPreset ? ` (${contextPreset.name})` : '';
        preview.innerHTML = `<strong>${presetName ? presetName.substring(2, presetName.length - 1) : ''} ${tokenInfo}</strong><br>${escapeHtml(displayText)}`;
    }
}

function setupEventListeners() {
    document.getElementById('toggle-preview').addEventListener('click', () => {
        const container = document.getElementById('preview-container');
        const button = document.getElementById('toggle-preview');
        const preview = document.getElementById('text-preview');
        const isExpanded = container.classList.contains('expanded');
        const presetName = contextPreset ? ` (${contextPreset.name})` : '';

        container.classList.toggle('expanded');

        const fullText = preview.dataset.fullText || '';
        const maxLength = 150;
        const truncated = fullText.length > maxLength ? fullText.substring(0, maxLength) + '...' : fullText;
        const showText = isExpanded ? truncated : fullText;

        const estimatedTokens = estimatePreviewTokens(fullText);
        const tokenInfo = `<span class="token-count" title="Оценка для запроса: текст выделения + system prompt пресета. Реальное число от API см. в ↑ под ответом.">~${estimatedTokens} токенов</span>`;

        button.textContent = isExpanded ? '[+]' : '[-]';

        if (preview.dataset.isPageContent === 'true') {
            preview.innerHTML = `<strong>📄 Full page content${presetName} ${tokenInfo}</strong><br>${escapeHtml(showText)}`;
        } else {
            preview.innerHTML = `<strong>${presetName ? presetName.substring(2, presetName.length - 1) : ''} ${tokenInfo}</strong><br>${escapeHtml(showText)}`;
        }
    });

    document.getElementById('model-select').addEventListener('change', (e) => {
        currentSettings.model = e.target.value;
    });

    document.getElementById('followup-preset-select').addEventListener('change', (e) => {
        const presetId = e.target.value;
        const preset = currentSettings.followupPresets.find(p => p.id === presetId);
        if (preset) {
            applyFollowupPreset(preset);
        }
    });

    document.getElementById('context-preset-select').addEventListener('change', handleContextPresetChange);

    document.getElementById('temp-slider').addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        document.getElementById('temp-value').textContent = value.toFixed(1);
    });

    document.getElementById('ask-button').addEventListener('click', handleAskOrStop);

    document.getElementById('copy-current-response').addEventListener('click', handleCopyCurrentResponse);

    const followUpInput = document.getElementById('follow-up-input');

    followUpInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleAskOrStop();
        }
    });

    followUpInput.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 150) + 'px';
    });

    // Escape: stop an in-flight generation, or close the popup window when idle.
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (isProcessing) {
            stopGeneration();
        } else {
            window.close();
        }
    });

    // Focus the input so the user can immediately type a follow-up / press Enter.
    followUpInput.focus();
}

// === New helpers ===

function getResponseContent() {
    return document.getElementById('response-content');
}

function setResponseContentHtml(html) {
    const el = getResponseContent();
    if (el) el.innerHTML = html;
}

function showLoading(message) {
    setResponseContentHtml(`<div class="loading">${escapeHtml(message || 'Processing...')}</div>`);
    showCopyButton(false);
}

function showCopyButton(visible) {
    const btn = document.getElementById('copy-current-response');
    if (btn) btn.style.display = visible ? '' : 'none';
}

function setProcessing(state) {
    isProcessing = state;
    const btn = document.getElementById('ask-button');
    if (!btn) return;
    if (state) {
        btn.textContent = '⏹ Stop';
        btn.classList.add('stopping');
        btn.disabled = false;
    } else {
        btn.textContent = 'Ask';
        btn.classList.remove('stopping');
        btn.disabled = false;
    }
}

function stopGeneration() {
    if (currentAbortController) {
        try { currentAbortController.abort(); } catch (_) { /* ignore */ }
    }
}

function handleAskOrStop() {
    if (isProcessing) {
        stopGeneration();
    } else {
        sendFollowUpQuestion();
    }
}

function getPromptContext() {
    return {
        selectedText: initialContext.text,
        pageUrl: initialContext.sourceUrl,
        pageTitle: initialContext.sourceTitle
    };
}

async function handleContextPresetChange(e) {
    const newId = e.target.value;
    const newPreset = currentSettings.contextPresets.find(p => p.id === newId);
    if (!newPreset) return;
    if (contextPreset && newPreset.id === contextPreset.id) return;

    if (messages.length > 0) {
        const ok = confirm(`Switch context preset to "${newPreset.name}"?\n\nThis restarts the conversation from the original text.`);
        if (!ok) {
            // revert UI selection
            e.target.value = contextPreset ? contextPreset.id : '';
            return;
        }
    }

    if (isProcessing) stopGeneration();

    contextPreset = newPreset;
    messages = [];
    document.getElementById('message-history').innerHTML = '';
    lastResponseMarkdown = '';
    currentStreamingMarkdown = '';
    showCopyButton(false);

    displayTextPreview(initialContext.text, initialContext.isPageContent);

    await sendToAI(initialContext.text, false);
}

async function handleCopyCurrentResponse() {
    const md = lastResponseMarkdown || currentStreamingMarkdown || '';
    await copyMarkdownTo(document.getElementById('copy-current-response'), md);
}

async function copyMarkdownTo(btn, md) {
    if (!md || !btn) return;
    try {
        await navigator.clipboard.writeText(md);
        const original = btn.textContent;
        btn.textContent = '✓';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.textContent = original;
            btn.classList.remove('copied');
        }, 1500);
    } catch (e) {
        console.error('Copy failed:', e);
    }
}

function attachCopyButtonToHistoryItem(messageDiv, markdown) {
    const btn = document.createElement('button');
    btn.className = 'copy-action';
    btn.title = 'Copy as Markdown';
    btn.textContent = '📋';
    btn.dataset.markdown = markdown || '';
    btn.addEventListener('click', () => copyMarkdownTo(btn, btn.dataset.markdown || ''));
    messageDiv.insertBefore(btn, messageDiv.firstChild);
}

function appendUsageFooter(displayElement, usage, durationMs) {
    if (!displayElement) return;
    const hasTokens = usage && (usage.inputTokens || usage.outputTokens);
    if (!hasTokens && !durationMs) return;
    const div = document.createElement('div');
    div.className = 'usage-footer';
    const parts = [];
    if (usage && usage.inputTokens) parts.push(`↑ ${usage.inputTokens.toLocaleString('ru-RU')}`);
    if (usage && usage.outputTokens) parts.push(`↓ ${usage.outputTokens.toLocaleString('ru-RU')}`);
    if (durationMs) parts.push(`${(durationMs / 1000).toFixed(1)}s`);
    div.textContent = parts.join(' · ');
    displayElement.appendChild(div);
}

// Pre-flight token budget check; returns true if OK, otherwise renders the
// error in the response area and returns false.
function checkTokenBudgetOrError(allMessages, systemPrompt, useModel) {
    // Sum the weighted estimate over each real text fragment so Cyrillic/CJK is
    // counted the same way as the preview (chars/3) rather than as ASCII.
    let tokens = estimateTokenCount(systemPrompt || '');
    for (const m of allMessages) {
        if (m && m.parts) {
            for (const p of m.parts) tokens += estimateTokenCount(p.text || '');
        }
    }
    const limit = getModelContextLimit(useModel);
    if (tokens > Math.floor(limit * 0.9)) {
        showError(
            'Текст слишком большой для модели',
            `Оценка ~${tokens.toLocaleString('ru-RU')} токенов. Контекст ${stripModelPrefix(useModel)}: ~${limit.toLocaleString('ru-RU')} токенов.`,
            'Выдели меньший фрагмент или выбери модель с бо́льшим контекстом.'
        );
        return false;
    }
    return true;
}

async function sendFollowUpQuestion() {
    const input = document.getElementById('follow-up-input');
    const question = input.value.trim();

    if (!question || isProcessing) return;

    const responseContent = getResponseContent();
    const hasContent = responseContent && responseContent.children.length > 0;
    const hasLoading = !!(responseContent && responseContent.querySelector('.loading'));
    const hasError = !!(responseContent && responseContent.querySelector('.error-message'));

    if (hasContent && !hasLoading && !hasError) {
        // Move current response into history with its own copy button
        const historyDiv = document.getElementById('message-history');
        const modelMessageDiv = document.createElement('div');
        modelMessageDiv.className = 'model-message';

        while (responseContent.firstChild) {
            modelMessageDiv.appendChild(responseContent.firstChild);
        }

        attachCopyButtonToHistoryItem(modelMessageDiv, lastResponseMarkdown);
        historyDiv.appendChild(modelMessageDiv);
        showCopyButton(false);
        lastResponseMarkdown = '';
        currentStreamingMarkdown = '';
    } else if (hasError) {
        // Don't carry the error into history; just clear it.
        responseContent.innerHTML = '';
    }

    addUserMessageToHistory(question);

    input.value = '';
    input.style.height = 'auto';

    await sendToAI(question, true);
}

function addUserMessageToHistory(message) {
    const historyDiv = document.getElementById('message-history');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'user-message';
    messageDiv.textContent = message;
    historyDiv.appendChild(messageDiv);

    messageDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function sendToAI(message, isFollowUp) {
    const provider = currentSettings.apiProvider;

    if (provider === 'google') {
        await sendToGemini(message, isFollowUp);
    } else {
        await sendToOpenAI(message, isFollowUp);
    }
}

async function sendToGemini(message, isFollowUp) {
    if (!currentSettings.apiKey) {
        showError('API key not configured', 'No Gemini API key was found in settings.', 'Open extension settings and add your Gemini API key.');
        return;
    }

    setProcessing(true);
    showLoading('Processing...');

    const displayElement = getResponseContent();
    // Claim a sequence number for the whole invocation (including the early
    // validation returns below) so the finally block always resets state for
    // the latest request, and stale/superseded callbacks bail out.
    const mySeq = ++requestSeq;

    try {
        let preset;
        let useModel, useTemp, useBudget;

        if (!isFollowUp) {
            preset = contextPreset;
            if (!preset) {
                showError('No context preset loaded');
                return;
            }
            useModel = preset.model || currentSettings.defaultModel;
            useTemp = validateTemperature(preset.temperature);
            useBudget = validateThinkingBudget(preset.thinkingBudget);
        } else {
            preset = currentFollowupPreset;
            if (!preset) {
                showError('No follow-up preset selected');
                return;
            }
            useModel = currentSettings.model;
            const tempSlider = document.getElementById('temp-slider');
            const budgetInput = document.getElementById('budget-input');
            useTemp = validateTemperature(tempSlider.value);
            useBudget = validateThinkingBudget(budgetInput.value);
        }

        if (!isFollowUp) {
            messages = [{ role: 'user', parts: [{ text: message }] }];
        } else {
            messages.push({ role: 'user', parts: [{ text: message }] });
        }

        const resolvedSystemPrompt = preset.systemPrompt
            ? applyPromptVariables(preset.systemPrompt, getPromptContext())
            : '';

        // Pre-flight token budget check
        if (!checkTokenBudgetOrError(messages, resolvedSystemPrompt, useModel)) {
            if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
                messages.pop();
            }
            return;
        }

        const requestBody = {
            contents: messages,
            generationConfig: { temperature: useTemp }
        };

        if (resolvedSystemPrompt) {
            requestBody.systemInstruction = {
                role: 'user',
                parts: [{ text: resolvedSystemPrompt }]
            };
        }

        if (useBudget !== 0) {
            requestBody.generationConfig.thinkingConfig = { thinking_budget: useBudget };
        }

        const model = addModelPrefix(useModel);
        const url = `https://generativelanguage.googleapis.com/v1beta/${model}:streamGenerateContent?alt=sse&key=${currentSettings.apiKey}`;

        currentAbortController = new AbortController();
        lastRequestStartedAt = performance.now();
        currentStreamingMarkdown = '';

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: currentAbortController.signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            const err = new Error(parseApiErrorBody(errorText) || `HTTP ${response.status}`);
            err.status = response.status;
            err.body = errorText;
            throw err;
        }

        const result = await handleStreamingResponse(response, displayElement);
        const fullResponse = result.content;
        const usage = result.usage;
        const duration = performance.now() - lastRequestStartedAt;

        appendUsageFooter(displayElement, usage, duration);
        lastResponseMarkdown = fullResponse;
        showCopyButton(!!fullResponse);

        messages.push({ role: 'model', parts: [{ text: fullResponse }] });

    } catch (error) {
        // A newer request has superseded this one (e.g. preset switch); don't
        // let this stale callback touch shared state.
        if (mySeq !== requestSeq) return;
        if (error.name === 'AbortError' || (error.message && /aborted/i.test(error.message))) {
            handleAbortedResponse(displayElement);
        } else {
            console.error('Gemini API error:', error);
            if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
                messages.pop();
            }
            showApiError(error);
        }
    } finally {
        if (mySeq === requestSeq) {
            setProcessing(false);
            currentAbortController = null;
        }
    }
}

async function sendToOpenAI(message, isFollowUp) {
    if (!currentSettings.openaiApiKey || !currentSettings.openaiBaseUrl) {
        showError(
            'OpenAI API not configured',
            'Base URL or API key is missing.',
            'Open extension settings and fill in OpenAI Base URL and API key.'
        );
        return;
    }

    setProcessing(true);
    showLoading('Processing...');

    const displayElement = getResponseContent();
    // Claim a sequence number for the whole invocation (including the early
    // validation returns below) so the finally block always resets state for
    // the latest request, and stale/superseded callbacks bail out.
    const mySeq = ++requestSeq;

    try {
        let preset;
        let useModel, useTemp, useBudget;

        if (!isFollowUp) {
            preset = contextPreset;
            if (!preset) {
                showError('No context preset loaded');
                return;
            }
            useModel = preset.model || currentSettings.defaultModel;
            useTemp = validateTemperature(preset.temperature);
            useBudget = validateThinkingBudget(preset.thinkingBudget);
        } else {
            preset = currentFollowupPreset;
            if (!preset) {
                showError('No follow-up preset selected');
                return;
            }
            useModel = currentSettings.model;
            const tempSlider = document.getElementById('temp-slider');
            const budgetInput = document.getElementById('budget-input');
            useTemp = validateTemperature(tempSlider.value);
            useBudget = validateThinkingBudget(budgetInput.value);
        }

        if (!isFollowUp) {
            messages = [{ role: 'user', parts: [{ text: message }] }];
        } else {
            messages.push({ role: 'user', parts: [{ text: message }] });
        }

        const resolvedSystemPrompt = preset.systemPrompt
            ? applyPromptVariables(preset.systemPrompt, getPromptContext())
            : '';

        // Pre-flight token budget check
        if (!checkTokenBudgetOrError(messages, resolvedSystemPrompt, useModel)) {
            if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
                messages.pop();
            }
            return;
        }

        const openAIMessages = [];

        if (resolvedSystemPrompt) {
            openAIMessages.push({ role: 'system', content: resolvedSystemPrompt });
        }

        messages.forEach(msg => {
            let role = msg.role;
            if (role === 'model') role = 'assistant';
            const content = msg.parts.map(p => p.text).join('');
            openAIMessages.push({ role: role, content: content });
        });

        const requestBody = {
            model: useModel,
            messages: openAIMessages,
            temperature: useTemp,
            stream: true,
            stream_options: { include_usage: true }
        };

        // GLM (Z.AI / Zhipu) supports a top-level `thinking` toggle.
        if (isGlmModel(useModel)) {
            requestBody.thinking = { type: useBudget === 0 ? 'disabled' : 'enabled' };
        }

        const baseUrl = currentSettings.openaiBaseUrl.replace(/\/$/, '');
        const url = `${baseUrl}/chat/completions`;

        currentAbortController = new AbortController();
        lastRequestStartedAt = performance.now();
        currentStreamingMarkdown = '';

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentSettings.openaiApiKey}`
            },
            body: JSON.stringify(requestBody),
            signal: currentAbortController.signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            const err = new Error(parseApiErrorBody(errorText) || `HTTP ${response.status}`);
            err.status = response.status;
            err.body = errorText;
            throw err;
        }

        const result = await handleOpenAIStreamingResponse(response, displayElement);
        const fullResponse = result.content;
        const usage = result.usage;
        const duration = performance.now() - lastRequestStartedAt;

        appendUsageFooter(displayElement, usage, duration);
        lastResponseMarkdown = fullResponse;
        showCopyButton(!!fullResponse);

        messages.push({ role: 'model', parts: [{ text: fullResponse }] });

    } catch (error) {
        // A newer request has superseded this one (e.g. preset switch); don't
        // let this stale callback touch shared state.
        if (mySeq !== requestSeq) return;
        if (error.name === 'AbortError' || (error.message && /aborted/i.test(error.message))) {
            handleAbortedResponse(displayElement);
        } else {
            console.error('OpenAI API error:', error);
            if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
                messages.pop();
            }
            showApiError(error);
        }
    } finally {
        if (mySeq === requestSeq) {
            setProcessing(false);
            currentAbortController = null;
        }
    }
}

function handleAbortedResponse(displayElement) {
    // Pop the dangling user message — same as for any other failure.
    if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
        messages.pop();
    }
    if (!displayElement) return;
    const hasContent = currentStreamingMarkdown && currentStreamingMarkdown.length > 0;
    if (hasContent) {
        // Keep partial content + a stopped marker; allow copy of partial.
        const marker = document.createElement('div');
        marker.className = 'stopped-marker';
        marker.textContent = '⏹ Остановлено пользователем';
        displayElement.appendChild(marker);
        lastResponseMarkdown = currentStreamingMarkdown;
        showCopyButton(true);
    } else {
        showError('Остановлено', 'Запрос отменён до начала ответа.');
    }
}

async function handleStreamingResponse(response, displayElement) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');

    let buffer = '';
    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;

    displayElement.innerHTML = '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const jsonStr = line.substring(6).trim();
                if (!jsonStr || jsonStr === '[DONE]') continue;

                try {
                    const data = JSON.parse(jsonStr);
                    if (data && data.usageMetadata) {
                        inputTokens = data.usageMetadata.promptTokenCount || inputTokens;
                        outputTokens = data.usageMetadata.candidatesTokenCount || outputTokens;
                    }
                    const candidate = data?.candidates?.[0];

                    if (!candidate) continue;

                    if (candidate.finishReason && candidate.finishReason !== 'STOP') {
                        console.warn('Gemini finish reason:', candidate.finishReason);
                        if (candidate.finishReason === 'SAFETY') {
                            fullContent += '\n\n⚠️ _Response was stopped for safety reasons._';
                        }
                    }

                    const part = candidate.content?.parts?.[0];
                    if (part?.text) {
                        fullContent += part.text;
                        renderContent(fullContent, displayElement);
                    }

                } catch (error) {
                    console.warn('Chunk parsing error:', error);
                }
            }
        }
    }

    return { content: fullContent, usage: { inputTokens: inputTokens, outputTokens: outputTokens } };
}

async function handleOpenAIStreamingResponse(response, displayElement) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');

    let buffer = '';
    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;

    displayElement.innerHTML = '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue;

            const jsonStr = trimmedLine.substring(6).trim();
            if (jsonStr === '[DONE]') continue;

            try {
                const data = JSON.parse(jsonStr);
                if (data && data.usage) {
                    inputTokens = data.usage.prompt_tokens || inputTokens;
                    outputTokens = data.usage.completion_tokens || outputTokens;
                }
                const delta = data.choices?.[0]?.delta;

                if (delta?.content) {
                    fullContent += delta.content;
                    renderContent(fullContent, displayElement);
                }

            } catch (error) {
                console.warn('Chunk parsing error:', error);
            }
        }
    }

    return { content: fullContent, usage: { inputTokens: inputTokens, outputTokens: outputTokens } };
}

function renderContent(content, element) {
    currentStreamingMarkdown = content;

    const thinkingBlocks = [];
    let processedContent = content;

    // 1. Handle closed blocks <think>...</think>
    const closedThinkingRegex = /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi;
    processedContent = processedContent.replace(closedThinkingRegex, (match, thinkingContent) => {
        const id = `THINKING_BLOCK_${thinkingBlocks.length}_PLACEHOLDER`;
        thinkingBlocks.push({
            id: id,
            content: thinkingContent.trim(),
            isOpen: false
        });
        return `\n\n${id}\n\n`;
    });

    // 2. Handle open block at the end (for streaming)
    const openThinkingRegex = /<think(?:ing)?>([\s\S]*?)$/i;
    const openMatch = openThinkingRegex.exec(processedContent);

    if (openMatch) {
        const thinkingContent = openMatch[1];
        const id = `THINKING_BLOCK_${thinkingBlocks.length}_PLACEHOLDER`;

        processedContent = processedContent.substring(0, openMatch.index) + `\n\n${id}\n\n`;

        thinkingBlocks.push({
            id: id,
            content: thinkingContent.trim(),
            isOpen: true
        });
    }

    let html = marked.parse(processedContent);

    thinkingBlocks.forEach(block => {
        const escapedBlock = block.content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

        const summaryText = block.isOpen ? '💭 Thinking...' : '💭 Thought Process';
        const detailsAttribute = block.isOpen ? ' open' : '';

        const thinkingHtml = `
      <details class="thinking-block"${detailsAttribute}>
        <summary>${summaryText}</summary>
        <div class="thinking-content">${escapedBlock}</div>
      </details>
    `;

        html = html.replace(block.id, () => thinkingHtml);
    });

    element.innerHTML = html;
}

// Rich error display: title (always shown), optional detail, optional hint.
// Backwards-compatible: showError('msg') still works as before.
function showError(title, detail, hint) {
    const html = `
        <div class="error-message">
            <strong>⚠️ ${escapeHtml(title || 'Error')}</strong>
            ${detail ? `<div class="error-detail">${escapeHtml(detail)}</div>` : ''}
            ${hint ? `<div class="error-hint">→ ${escapeHtml(hint)}</div>` : ''}
        </div>
    `;
    setResponseContentHtml(html);
    showCopyButton(false);
}

function showApiError(error) {
    const status = error && error.status ? error.status : 0;
    const bodyDetail = error && error.body ? parseApiErrorBody(error.body) : (error && error.message) || '';

    let title, hint;
    if (status === 401 || status === 403) {
        title = 'Ошибка авторизации';
        hint = 'Проверь API-ключ в настройках расширения.';
    } else if (status === 429) {
        title = 'Лимит запросов';
        hint = 'Подожди минуту и попробуй снова, либо переключи модель.';
    } else if (status === 400) {
        title = 'Неверный запрос';
        hint = 'Возможно, превышен контекст или передан неподдерживаемый параметр. Попробуй меньший текст или другую модель.';
    } else if (status === 404) {
        title = 'Не найдено';
        hint = 'Проверь имя модели и Base URL в настройках.';
    } else if (status >= 500) {
        title = 'Сбой сервера провайдера';
        hint = 'Подожди и попробуй снова. Если повторяется — проверь статус провайдера.';
    } else if (status === 0) {
        title = 'Сеть недоступна';
        hint = 'Проверь интернет-соединение и Base URL.';
    } else {
        title = `Ошибка (HTTP ${status})`;
        hint = '';
    }

    showError(title, bodyDetail, hint);
}

chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === 'local') {
        if (changes.contextPresets) {
            console.log('Context presets updated');
            currentSettings.contextPresets = changes.contextPresets.newValue;
        }

        if (changes.followupPresets) {
            console.log('Follow-up presets updated, reloading...');
            currentSettings.followupPresets = changes.followupPresets.newValue;
            await loadFollowupPresets();
        }

        if (changes.defaultModel) {
            currentSettings.model = changes.defaultModel.newValue;
            const modelSelect = document.getElementById('model-select');
            if (modelSelect) {
                modelSelect.value = changes.defaultModel.newValue;
            }
        }

        if (changes.colorTheme || changes.fontSize || changes.fontFamily) {
            await loadSettings();
            applyFontSettings();
        }
    }
});
