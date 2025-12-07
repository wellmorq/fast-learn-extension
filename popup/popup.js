let messages = [];
let currentSettings = {};
let isProcessing = false;
let contextPreset = null;  // Preset used when opening popup (for initial request)
let currentFollowupPreset = null;  // Currently selected follow-up preset
let followupPresetOriginalValues = {};  // Original preset values for proper switching

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

    await loadPresets();
    await loadModels();
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
    await loadContextPreset();
    await loadFollowupPresets();
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

    // Store original preset values for proper switching
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

    if (preset.model) {
        currentSettings.model = preset.model;
        const modelSelect = document.getElementById('model-select');
        if (modelSelect) {
            modelSelect.value = preset.model;
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

    models.forEach(model => {
        const option = document.createElement('option');
        const displayName = stripModelPrefix(model);
        option.value = model;
        option.textContent = displayName;
        if (model === currentSettings.model || displayName === currentSettings.model) {
            option.selected = true;
        }
        modelSelect.appendChild(option);
    });
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

    if (isPageContent) {
        const presetName = contextPreset ? ` (${contextPreset.name})` : '';
        preview.innerHTML = `<strong>📄 Full page content${presetName}</strong><br>${displayText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}`;
    } else {
        const presetName = contextPreset ? ` (${contextPreset.name})` : '';
        preview.innerHTML = `<strong>${presetName ? presetName.substring(2, presetName.length - 1) : ''}</strong><br>${displayText}`;
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

            if (preview.dataset.isPageContent === 'true') {
                preview.innerHTML = `<strong>📄 Full page content${presetName}</strong><br>${displayText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}`;
            } else {
                preview.innerHTML = `<strong>${presetName ? presetName.substring(2, presetName.length - 1) : ''}</strong><br>${displayText}`;
            }
        } else {
            button.textContent = '[-]';
            const fullText = preview.dataset.fullText || '';

            if (preview.dataset.isPageContent === 'true') {
                preview.innerHTML = `<strong>📄 Full page content${presetName}</strong><br>${fullText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}`;
            } else {
                preview.innerHTML = `<strong>${presetName ? presetName.substring(2, presetName.length - 1) : ''}</strong><br>${fullText}`;
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
    if (responseArea.children.length > 0 && !responseArea.innerHTML.includes('class="loading"')) {
        const historyDiv = document.getElementById('message-history');
        const modelMessageDiv = document.createElement('div');
        modelMessageDiv.className = 'model-message';

        // Move all children to preserve formatting and structure
        while (responseArea.firstChild) {
            modelMessageDiv.appendChild(responseArea.firstChild);
        }

        historyDiv.appendChild(modelMessageDiv);
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
        if (!isFollowUp) {
            preset = contextPreset;
            if (!preset) {
                showError('No context preset loaded');
                return;
            }
        } else {
            preset = currentFollowupPreset;
            if (!preset) {
                showError('No follow-up preset selected');
                return;
            }
        }

        // Store messages in Google format internally
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

        const tempSlider = document.getElementById('temp-slider');
        const budgetInput = document.getElementById('budget-input');
        const currentTemperature = parseFloat(tempSlider.value);
        const currentThinkingBudget = parseInt(budgetInput.value);

        const requestBody = {
            contents: messages,
            generationConfig: {
                temperature: currentTemperature
            }
        };

        if (preset.systemPrompt) {
            requestBody.systemInstruction = {
                role: 'user',
                parts: [{ text: preset.systemPrompt }]
            };
        }

        if (currentThinkingBudget !== 0) {
            requestBody.generationConfig.thinkingConfig = {
                thinking_budget: currentThinkingBudget
            };
        }

        const model = addModelPrefix(currentSettings.model);
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
        if (!isFollowUp) {
            preset = contextPreset;
            if (!preset) {
                showError('No context preset loaded');
                return;
            }
        } else {
            preset = currentFollowupPreset;
            if (!preset) {
                showError('No follow-up preset selected');
                return;
            }
        }

        // Maintain internal messages in Google format for consistency with other parts of the app
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

        // Convert messages to OpenAI format
        const openAIMessages = [];

        // Add System Prompt if available
        if (preset.systemPrompt) {
            openAIMessages.push({
                role: 'system',
                content: preset.systemPrompt
            });
        }

        // Convert history
        messages.forEach(msg => {
            let role = msg.role;
            // Google uses 'model', OpenAI uses 'assistant'
            if (role === 'model') role = 'assistant';

            // Extract text from parts
            const content = msg.parts.map(p => p.text).join('');

            openAIMessages.push({
                role: role,
                content: content
            });
        });

        const tempSlider = document.getElementById('temp-slider');
        const currentTemperature = parseFloat(tempSlider.value);

        const requestBody = {
            model: currentSettings.model,
            messages: openAIMessages,
            temperature: currentTemperature,
            stream: true
        };

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

        // Store response in Google format for history
        messages.push({
            role: 'model',
            parts: [{ text: fullResponse }]
        });

    } catch (error) {
        console.error('OpenAI API error:', error);
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
    const thinkingRegex = /<thinking>([\s\S]*?)<\/thinking>/gi;
    const thinkingBlocks = [];

    let processedContent = content.replace(thinkingRegex, (match, thinkingContent) => {
        thinkingBlocks.push(thinkingContent.trim());
        return '___THINKING_PLACEHOLDER___';
    });

    let html = marked.parse(processedContent);

    thinkingBlocks.forEach(block => {
        const escapedBlock = block
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

        const thinkingHtml = `
      <details class="thinking-block">
        <summary>💭 Процесс размышления...</summary>
        <div class="thinking-content">${escapedBlock}</div>
      </details>
    `;

        html = html.replace('___THINKING_PLACEHOLDER___', thinkingHtml);
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

