let messages = [];
let currentSettings = {};
let isProcessing = false;
let contextPreset = null;
let currentFollowupPreset = null;
let followupPresetOriginalValues = {};

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

    const { selectedText, isPageContent, selectedPresetId } = await chrome.storage.local.get(['selectedText', 'isPageContent', 'selectedPresetId']);

    if (!selectedText) {
        showError('No text to process');
        return;
    }

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
        defaultModel: settings.defaultModel || 'gemini-2.0-flash-exp',
        model: settings.defaultModel || 'gemini-2.0-flash-exp',
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

    if (!currentSettings.contextPresets || currentSettings.contextPresets.length === 0) {
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
    const modelSelect = document.getElementById('model-select');
    const { cachedModels } = await chrome.storage.local.get('cachedModels');

    if (cachedModels && cachedModels.length > 0) {
        populateModelSelect(cachedModels);
    } else {
        const defaultModels = [
            'gemini-2.0-flash-exp',
            'gemini-2.0-flash-thinking-exp-01-21',
            'gemini-exp-1206',
            'gemini-1.5-pro',
            'gemini-1.5-flash'
        ];
        populateModelSelect(defaultModels);
    }
}

function populateModelSelect(models) {
    const modelSelect = document.getElementById('model-select');
    modelSelect.innerHTML = '';

    let isSelected = false;

    models.forEach(model => {
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

    if (!isSelected && models.length > 0) {
        modelSelect.selectedIndex = 0;
        currentSettings.model = models[0];
    }
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

    const estimatedTokens = estimateTokenCount(text);
    const tokenInfo = `<span class="token-count" title="Примерное количество токенов">${estimatedTokens} токенов</span>`;

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

        if (isExpanded) {
            button.textContent = '[+]';
            const fullText = preview.dataset.fullText || '';
            const maxLength = 150;
            const displayText = fullText.length > maxLength ? fullText.substring(0, maxLength) + '...' : fullText;

            const estimatedTokens = estimateTokenCount(fullText);
            const tokenInfo = `<span class="token-count" title="Примерное количество токенов">${estimatedTokens} токенов</span>`;

            if (preview.dataset.isPageContent === 'true') {
                preview.innerHTML = `<strong>📄 Full page content${presetName} ${tokenInfo}</strong><br>${escapeHtml(displayText)}`;
            } else {
                preview.innerHTML = `<strong>${presetName ? presetName.substring(2, presetName.length - 1) : ''} ${tokenInfo}</strong><br>${escapeHtml(displayText)}`;
            }
        } else {
            button.textContent = '[-]';
            const fullText = preview.dataset.fullText || '';

            const estimatedTokens = estimateTokenCount(fullText);
            const tokenInfo = `<span class="token-count" title="Примерное количество токенов">${estimatedTokens} токенов</span>`;

            if (preview.dataset.isPageContent === 'true') {
                preview.innerHTML = `<strong>📄 Full page content${presetName} ${tokenInfo}</strong><br>${escapeHtml(fullText)}`;
            } else {
                preview.innerHTML = `<strong>${presetName ? presetName.substring(2, presetName.length - 1) : ''} ${tokenInfo}</strong><br>${escapeHtml(fullText)}`;
            }
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

    document.getElementById('temp-slider').addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        document.getElementById('temp-value').textContent = value.toFixed(1);
    });

    document.getElementById('ask-button').addEventListener('click', sendFollowUpQuestion);

    const followUpInput = document.getElementById('follow-up-input');

    followUpInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendFollowUpQuestion();
        }
    });

    followUpInput.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 150) + 'px';
    });
}

async function sendFollowUpQuestion() {
    const input = document.getElementById('follow-up-input');
    const question = input.value.trim();

    if (!question || isProcessing) return;

    const responseArea = document.getElementById('response-area');
    const hasContent = responseArea.children.length > 0;
    const hasLoading = !!responseArea.querySelector('.loading');
    const hasError = !!responseArea.querySelector('.error-message');
    if (hasContent && !hasLoading && !hasError) {
        const historyDiv = document.getElementById('message-history');
        const modelMessageDiv = document.createElement('div');
        modelMessageDiv.className = 'model-message';

        while (responseArea.firstChild) {
            modelMessageDiv.appendChild(responseArea.firstChild);
        }

        historyDiv.appendChild(modelMessageDiv);
    } else if (hasError) {
        // Don't carry the error into history; just clear it.
        responseArea.innerHTML = '';
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
        showError('API key not configured. Please open extension settings and add your Gemini API key.');
        return;
    }

    isProcessing = true;
    document.getElementById('ask-button').disabled = true;

    const responseArea = document.getElementById('response-area');
    responseArea.innerHTML = '<div class="loading">Processing...</div>';

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
            messages = [{
                role: 'user',
                parts: [{ text: message }]
            }];
        } else {
            messages.push({
                role: 'user',
                parts: [{ text: message }]
            });
        }

        const requestBody = {
            contents: messages,
            generationConfig: {
                temperature: useTemp
            }
        };

        if (preset.systemPrompt) {
            requestBody.systemInstruction = {
                role: 'user',
                parts: [{ text: preset.systemPrompt }]
            };
        }

        if (useBudget !== 0) {
            requestBody.generationConfig.thinkingConfig = {
                thinking_budget: useBudget
            };
        }

        const model = addModelPrefix(useModel);
        const url = `https://generativelanguage.googleapis.com/v1beta/${model}:streamGenerateContent?alt=sse&key=${currentSettings.apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API Error ${response.status}: ${errorText}`);
        }

        const fullResponse = await handleStreamingResponse(response, responseArea);

        messages.push({
            role: 'model',
            parts: [{ text: fullResponse }]
        });

    } catch (error) {
        console.error('Gemini API error:', error);
        if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
            messages.pop();
        }
        showError(formatApiError(error, error.status || 0));
    } finally {
        isProcessing = false;
        document.getElementById('ask-button').disabled = false;
    }
}

async function sendToOpenAI(message, isFollowUp) {
    if (!currentSettings.openaiApiKey || !currentSettings.openaiBaseUrl) {
        showError('OpenAI API key or Base URL not configured. Please open extension settings.');
        return;
    }

    isProcessing = true;
    document.getElementById('ask-button').disabled = true;

    const responseArea = document.getElementById('response-area');
    responseArea.innerHTML = '<div class="loading">Processing...</div>';

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
            messages = [{
                role: 'user',
                parts: [{ text: message }]
            }];
        } else {
            messages.push({
                role: 'user',
                parts: [{ text: message }]
            });
        }

        const openAIMessages = [];

        if (preset.systemPrompt) {
            openAIMessages.push({
                role: 'system',
                content: preset.systemPrompt
            });
        }

        messages.forEach(msg => {
            let role = msg.role;
            if (role === 'model') role = 'assistant';

            const content = msg.parts.map(p => p.text).join('');

            openAIMessages.push({
                role: role,
                content: content
            });
        });

        const requestBody = {
            model: useModel,
            messages: openAIMessages,
            temperature: useTemp,
            stream: true
        };

        // GLM (Z.AI / Zhipu) supports a top-level `thinking` toggle.
        // budget === 0 means thinking disabled, anything else enables it.
        if (isGlmModel(useModel)) {
            requestBody.thinking = { type: useBudget === 0 ? 'disabled' : 'enabled' };
        }

        const baseUrl = currentSettings.openaiBaseUrl.replace(/\/$/, '');
        const url = `${baseUrl}/chat/completions`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentSettings.openaiApiKey}`
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API Error ${response.status}: ${errorText}`);
        }

        const fullResponse = await handleOpenAIStreamingResponse(response, responseArea);

        messages.push({
            role: 'model',
            parts: [{ text: fullResponse }]
        });

    } catch (error) {
        console.error('OpenAI API error:', error);
        if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
            messages.pop();
        }
        showError(formatApiError(error, error.status || 0));
    } finally {
        isProcessing = false;
        document.getElementById('ask-button').disabled = false;
    }
}

async function handleStreamingResponse(response, displayElement) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');

    let buffer = '';
    let fullContent = '';

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

    return fullContent;
}

async function handleOpenAIStreamingResponse(response, displayElement) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');

    let buffer = '';
    let fullContent = '';

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

    return fullContent;
}

function renderContent(content, element) {
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
        return `\n\n${id}\n\n`; // Add newlines to ensure it's treated as a block
    });

    // 2. Handle open block at the end (for streaming)
    const openThinkingRegex = /<think(?:ing)?>([\s\S]*?)$/i;
    const openMatch = openThinkingRegex.exec(processedContent);

    if (openMatch) {
        const thinkingContent = openMatch[1];
        const id = `THINKING_BLOCK_${thinkingBlocks.length}_PLACEHOLDER`;

        // Replace the open tag and content with placeholder
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
        // Auto-open if it's currently streaming (open)
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

function showError(message) {
    const responseArea = document.getElementById('response-area');
    responseArea.innerHTML = `<div class="error-message">${message}</div>`;
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

