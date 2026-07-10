let messages = [];
let currentSettings = {};
let isProcessing = false;
let contextPreset = null;
let currentFollowupPreset = null;
let followupPresetOriginalValues = {};

let initialContext = { text: '', isPageContent: false, sourceUrl: '', sourceTitle: '' };
let currentAbortController = null;
// Prevent stale streams from mutating a newer request.
let requestSeq = 0;
let lastResponseMarkdown = '';
let currentStreamingMarkdown = '';
let lastRequestStartedAt = 0;
let lastRequest = null;
const POPUP_CONTEXT_CACHE_KEY = 'fastLearn.lookupContext';

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

    const stored = await loadPopupLookupContext();
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

async function loadPopupLookupContext() {
    let cached = null;
    try {
        cached = sessionStorage.getItem(POPUP_CONTEXT_CACHE_KEY);
    } catch (error) {
        console.warn('Popup context cache is unavailable:', error.message);
    }

    if (cached) {
        try {
            return JSON.parse(cached);
        } catch (_) {
            try { sessionStorage.removeItem(POPUP_CONTEXT_CACHE_KEY); } catch (_) {}
        }
    }

    const contextId = new URLSearchParams(window.location.search).get('context');
    const context = await takeLookupContext(contextId);
    if (context.selectedText) {
        try {
            sessionStorage.setItem(POPUP_CONTEXT_CACHE_KEY, JSON.stringify(context));
        } catch (error) {
            console.warn('Popup context could not be cached for reload:', error.message);
        }
    }
    return context;
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

    const loadedSettings = withDefaultSettings(settings);
    currentSettings = {
        ...loadedSettings,
        model: loadedSettings.defaultModel,
        defaultContextPresetId: settings.defaultContextPresetId || null,
        defaultFollowupPresetId: settings.defaultFollowupPresetId || null,
        contextPresets: settings.contextPresets || [],
        followupPresets: settings.followupPresets || []
    };
}

function applyFontSettings() {
    document.documentElement.style.setProperty('--base-font-size', currentSettings.fontSize);
    document.documentElement.style.setProperty('--font-family', buildFontStack(currentSettings.fontFamily));
    document.documentElement.setAttribute('data-theme', currentSettings.colorTheme);
}

async function loadPresets() {
    await loadFollowupPresets();
    await loadContextPreset();
}

async function loadContextPreset() {
    const selectedPresetId = currentSettings.selectedPresetId || null;
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

    // Older caches have no provider tag and remain compatible.
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

    const desired = currentSettings.model;
    const list = includeSelectedModel(models, desired);

    let isSelected = false;

    list.forEach(model => {
        const option = document.createElement('option');
        const displayName = stripModelPrefix(model);
        option.value = model;
        option.textContent = displayName;
        if (modelNamesEqual(model, currentSettings.model)) {
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

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (isProcessing) {
            stopGeneration();
        } else {
            window.close();
        }
    });

    followUpInput.focus();
}

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
        try { currentAbortController.abort(); } catch (_) {}
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

function checkTokenBudgetOrError(allMessages, systemPrompt, useModel) {
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

function removeDanglingUserMessage() {
    if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
        messages.pop();
    }
}

function getRequestConfig(isFollowUp) {
    if (!isFollowUp) {
        const preset = contextPreset;
        if (!preset) {
            showError('No context preset loaded');
            return null;
        }

        return {
            preset: preset,
            model: preset.model || currentSettings.defaultModel,
            temperature: validateTemperature(preset.temperature),
            thinkingBudget: validateThinkingBudget(preset.thinkingBudget)
        };
    }

    const preset = currentFollowupPreset;
    if (!preset) {
        showError('No follow-up preset selected');
        return null;
    }

    const tempSlider = document.getElementById('temp-slider');
    const budgetInput = document.getElementById('budget-input');
    return {
        preset: preset,
        model: currentSettings.model,
        temperature: validateTemperature(tempSlider.value),
        thinkingBudget: validateThinkingBudget(budgetInput.value)
    };
}

function prepareRequest(message, isFollowUp) {
    const config = getRequestConfig(isFollowUp);
    if (!config) return null;

    if (!isFollowUp) {
        messages = [{ role: 'user', parts: [{ text: message }] }];
    } else {
        messages.push({ role: 'user', parts: [{ text: message }] });
    }

    const systemPrompt = config.preset.systemPrompt
        ? applyPromptVariables(config.preset.systemPrompt, getPromptContext())
        : '';

    if (!checkTokenBudgetOrError(messages, systemPrompt, config.model)) {
        removeDanglingUserMessage();
        return null;
    }

    return {
        model: config.model,
        temperature: config.temperature,
        thinkingBudget: config.thinkingBudget,
        systemPrompt: systemPrompt,
        messages: messages
    };
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
    lastRequest = { message, isFollowUp };
    const provider = currentSettings.apiProvider;

    if (provider === 'google') {
        await sendToGemini(message, isFollowUp);
    } else {
        await sendToOpenAI(message, isFollowUp);
    }
}

async function retryLastRequest() {
    if (!lastRequest || isProcessing) return;
    await sendToAI(lastRequest.message, lastRequest.isFollowUp);
}

async function sendToGemini(message, isFollowUp) {
    if (!currentSettings.apiKey) {
        showError('API key not configured', 'No Gemini API key was found in settings.', 'Open extension settings and add your Gemini API key.');
        return;
    }

    setProcessing(true);
    showLoading('Processing...');

    const displayElement = getResponseContent();
    const mySeq = ++requestSeq;

    try {
        const prepared = prepareRequest(message, isFollowUp);
        if (!prepared) return;

        const request = buildGeminiRequest(prepared, currentSettings.apiKey);

        currentAbortController = new AbortController();
        lastRequestStartedAt = performance.now();
        currentStreamingMarkdown = '';

        const response = await fetch(request.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request.body),
            signal: currentAbortController.signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            const err = new Error(parseApiErrorBody(errorText) || `HTTP ${response.status}`);
            err.status = response.status;
            err.body = errorText;
            throw err;
        }

        displayElement.innerHTML = '';
        const result = await readGeminiStream(response, content => {
            if (mySeq === requestSeq) renderContent(content, displayElement);
        });
        if (mySeq !== requestSeq) return;
        const fullResponse = result.content;
        const usage = result.usage;
        const duration = performance.now() - lastRequestStartedAt;

        appendUsageFooter(displayElement, usage, duration);
        lastResponseMarkdown = fullResponse;
        showCopyButton(!!fullResponse);

        messages.push({ role: 'model', parts: [{ text: fullResponse }] });

    } catch (error) {
        if (mySeq !== requestSeq) return;
        if (error.name === 'AbortError' || (error.message && /aborted/i.test(error.message))) {
            handleAbortedResponse(displayElement);
        } else {
            console.error('Gemini API error:', error);
            removeDanglingUserMessage();
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
    const mySeq = ++requestSeq;

    try {
        const prepared = prepareRequest(message, isFollowUp);
        if (!prepared) return;

        const request = buildOpenAICompatibleRequest(prepared, currentSettings.openaiBaseUrl);

        currentAbortController = new AbortController();
        lastRequestStartedAt = performance.now();
        currentStreamingMarkdown = '';

        const response = await fetch(request.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentSettings.openaiApiKey}`
            },
            body: JSON.stringify(request.body),
            signal: currentAbortController.signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            const err = new Error(parseApiErrorBody(errorText) || `HTTP ${response.status}`);
            err.status = response.status;
            err.body = errorText;
            throw err;
        }

        displayElement.innerHTML = '';
        const result = await readOpenAICompatibleStream(
            response,
            (content, streamState) => {
                if (mySeq === requestSeq) renderContent(content, displayElement, streamState);
            }
        );
        if (mySeq !== requestSeq) return;
        const fullResponse = result.content;
        const usage = result.usage;
        const duration = performance.now() - lastRequestStartedAt;

        if (result.hasReasoning) finalizeStreamingResponse(displayElement);
        appendUsageFooter(displayElement, usage, duration);
        lastResponseMarkdown = fullResponse;
        showCopyButton(!!fullResponse);

        messages.push({ role: 'model', parts: [{ text: fullResponse }] });

    } catch (error) {
        if (mySeq !== requestSeq) return;
        if (error.name === 'AbortError' || (error.message && /aborted/i.test(error.message))) {
            handleAbortedResponse(displayElement);
        } else {
            console.error('OpenAI API error:', error);
            removeDanglingUserMessage();
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
    removeDanglingUserMessage();
    if (!displayElement) return;
    const hasContent = currentStreamingMarkdown && currentStreamingMarkdown.length > 0;
    if (hasContent) {
        finalizeStreamingResponse(displayElement);
        const marker = document.createElement('div');
        marker.className = 'stopped-marker';
        marker.textContent = '⏹ Остановлено пользователем';
        displayElement.appendChild(marker);
        lastResponseMarkdown = currentStreamingMarkdown;
        showCopyButton(true);
    } else {
        showError('Остановлено', 'Запрос отменён до начала ответа.', '', { retry: retryLastRequest });
    }
}

function renderContent(content, element, streamState) {
    currentStreamingMarkdown = content;
    if (streamState && streamState.hasReasoning) {
        renderStreamingResponse(streamState.reasoning, streamState.content, element);
    } else {
        renderResponseContent(content, element);
    }
}

function showError(title, detail, hint, opts) {
    const html = `
        <div class="error-message">
            <strong>⚠️ ${escapeHtml(title || 'Error')}</strong>
            ${detail ? `<div class="error-detail">${escapeHtml(detail)}</div>` : ''}
            ${hint ? `<div class="error-hint">→ ${escapeHtml(hint)}</div>` : ''}
        </div>
    `;
    setResponseContentHtml(html);
    showCopyButton(false);

    if (opts && typeof opts.retry === 'function') {
        const errorBox = getResponseContent()?.querySelector('.error-message');
        if (errorBox) {
            const btn = document.createElement('button');
            btn.className = 'retry-button';
            btn.textContent = '🔄 Повторить';
            btn.addEventListener('click', opts.retry);
            errorBox.appendChild(btn);
        }
    }
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

    showError(title, bodyDetail, hint, { retry: retryLastRequest });
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
