let contextPresets = [];
let followupPresets = [];
let currentSettings = {};
let cachedModels = [];
let activeTab = 'general';

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await loadSettings();
        await loadPresets();
        await loadModels();
        setupEventListeners();
    } catch (error) {
        console.error('Initialization error:', error);
        showStatus('Error loading settings', 'error');
    }
});

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

    currentSettings = settings;

    // Set Provider
    const apiProvider = settings.apiProvider || 'google';
    document.getElementById('api-provider').value = apiProvider;
    toggleProviderSettings(apiProvider);

    // Google Settings
    document.getElementById('api-key').value = settings.apiKey || '';

    // OpenAI Settings
    document.getElementById('openai-base-url').value = settings.openaiBaseUrl || 'https://openrouter.ai/api/v1';
    document.getElementById('openai-api-key').value = settings.openaiApiKey || '';

    // General
    document.getElementById('font-size').value = settings.fontSize || '16px';
    document.getElementById('font-family').value = settings.fontFamily || 'Roboto';
    document.getElementById('color-theme').value = settings.colorTheme || 'soft-gray';

    applyTheme();
}

function toggleProviderSettings(provider) {
    const googleSection = document.getElementById('google-settings-section');
    const openaiSection = document.getElementById('openai-settings-section');

    if (provider === 'google') {
        googleSection.style.display = 'block';
        openaiSection.style.display = 'none';
    } else {
        googleSection.style.display = 'none';
        openaiSection.style.display = 'block';
    }
}

function applyTheme() {
    const fontSize = currentSettings.fontSize || '16px';
    const fontFamily = currentSettings.fontFamily || 'Roboto';
    const colorTheme = currentSettings.colorTheme || 'soft-gray';

    document.documentElement.style.setProperty('--base-font-size', fontSize);
    document.documentElement.style.setProperty('--font-family', fontFamily);
    document.documentElement.setAttribute('data-theme', colorTheme);
}

async function loadPresets() {
    const { contextPresets: ctx, followupPresets: flp } = await chrome.storage.local.get(['contextPresets', 'followupPresets']);
    contextPresets = ctx || [];
    followupPresets = flp || [];
    renderPresets('context');
    renderPresets('followup');
}

function renderPresets(type) {
    const containerId = type === 'context' ? 'context-presets-container' : 'followup-presets-container';
    const container = document.getElementById(containerId);
    const presets = type === 'context' ? contextPresets : followupPresets;

    container.innerHTML = '';

    if (presets.length === 0) {
        container.innerHTML = '<p style="color: #5f6368; text-align: center; padding: 20px;">No saved presets. Add your first preset!</p>';
        return;
    }

    presets.forEach((preset, index) => {
        const presetEl = createPresetElement(preset, index, type);
        container.appendChild(presetEl);
    });
}

function createPresetElement(preset, index, type) {
    const div = document.createElement('div');
    div.className = 'preset-item';
    div.dataset.presetId = preset.id;
    div.dataset.presetType = type;

    div.innerHTML = `
    <div class="preset-header">
      <div class="preset-name">
        <span class="preset-name-text">${escapeHtml(preset.name)}</span>
        <input type="text" class="preset-name-input" style="display: none;" value="${escapeHtml(preset.name)}">
      </div>
      <div class="preset-badges">
        ${preset.isDefault ? '<span class="default-badge">Default</span>' : ''}
      </div>
    </div>
    <div class="preset-text">
      <textarea class="preset-text-area" disabled>${escapeHtml(preset.systemPrompt)}</textarea>
    </div>
    <div class="preset-params">
      <div class="preset-param">
        <label class="preset-param-label">🌡️ Temperature:</label>
        <input type="number" class="preset-temperature" min="0" max="2.0" step="0.1" value="${preset.temperature}" disabled>
      </div>
      <div class="preset-param">
        <label class="preset-param-label">🧠 Thinking Budget:</label>
        <input type="number" class="preset-thinking" min="-1" max="24000" value="${preset.thinkingBudget}" disabled>
      </div>
      <div class="preset-param">
        <label class="preset-param-label">🤖 Model (optional):</label>
        <select class="preset-model" disabled>
          <option value="">Use default</option>
        </select>
      </div>
    </div>
    <div class="preset-footer">
      <div class="button-group">
        <button class="button button-secondary edit-preset-btn" data-index="${index}">✏️ Edit</button>
        <button class="button button-secondary save-preset-btn" data-index="${index}" style="display: none;">💾 Save</button>
        <button class="button button-secondary cancel-edit-btn" data-index="${index}" style="display: none;">❌ Cancel</button>
      </div>
      <div class="button-group">
        ${!preset.isDefault ? `<button class="button button-success set-default-btn" data-index="${index}" title="Set as Default">⭐</button>` : ''}
        <button class="button button-danger delete-preset-btn" data-index="${index}" title="Delete">🗑️</button>
      </div>
    </div>
  `;

    const modelSelect = div.querySelector('.preset-model');
    populateModelSelect(modelSelect, preset.model);

    setupPresetEventListeners(div, preset, index, type);

    return div;
}

function populateModelSelect(select, selectedModel) {
    select.innerHTML = '<option value="">Use default</option>';
    cachedModels.forEach(model => {
        const option = document.createElement('option');
        const displayName = stripModelPrefix(model);
        option.value = model;
        option.textContent = displayName;
        if (model === selectedModel) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

function setupPresetEventListeners(element, preset, index, type) {
    const nameText = element.querySelector('.preset-name-text');
    const nameInput = element.querySelector('.preset-name-input');
    const textarea = element.querySelector('.preset-text-area');
    const tempInput = element.querySelector('.preset-temperature');
    const thinkingInput = element.querySelector('.preset-thinking');
    const modelSelect = element.querySelector('.preset-model');

    const editBtn = element.querySelector('.edit-preset-btn');
    const saveBtn = element.querySelector('.save-preset-btn');
    const cancelBtn = element.querySelector('.cancel-edit-btn');
    const deleteBtn = element.querySelector('.delete-preset-btn');
    const setDefaultBtn = element.querySelector('.set-default-btn');

    const presets = type === 'context' ? contextPresets : followupPresets;

    editBtn.addEventListener('click', () => {
        nameText.style.display = 'none';
        nameInput.style.display = 'block';
        textarea.disabled = false;
        tempInput.disabled = false;
        thinkingInput.disabled = false;
        modelSelect.disabled = false;
        editBtn.style.display = 'none';
        saveBtn.style.display = 'inline-flex';
        cancelBtn.style.display = 'inline-flex';
        deleteBtn.disabled = true;
        if (setDefaultBtn) setDefaultBtn.disabled = true;
    });

    saveBtn.addEventListener('click', async () => {
        const newName = nameInput.value.trim();
        const newText = textarea.value.trim();
        const newTemp = parseFloat(tempInput.value);
        const newThinking = parseInt(thinkingInput.value);
        const newModel = modelSelect.value || null;

        if (!newName || !newText) {
            showStatus('Preset name and text cannot be empty', 'error');
            return;
        }

        presets[index].name = newName;
        presets[index].systemPrompt = newText;
        presets[index].temperature = newTemp;
        presets[index].thinkingBudget = newThinking;
        presets[index].model = newModel;

        const storageKey = type === 'context' ? 'contextPresets' : 'followupPresets';
        await chrome.storage.local.set({ [storageKey]: presets });
        renderPresets(type);
        showStatus('Preset updated', 'success');
    });

    cancelBtn.addEventListener('click', () => {
        renderPresets(type);
    });

    deleteBtn.addEventListener('click', async () => {
        if (presets.length === 1) {
            showStatus('Cannot delete the last preset', 'error');
            return;
        }

        if (!confirm(`Delete preset "${preset.name}"?`)) {
            return;
        }

        presets.splice(index, 1);

        if (preset.isDefault && presets.length > 0) {
            presets[0].isDefault = true;
        }

        const storageKey = type === 'context' ? 'contextPresets' : 'followupPresets';
        await chrome.storage.local.set({ [storageKey]: presets });
        renderPresets(type);
        showStatus('Preset deleted', 'success');
    });

    if (setDefaultBtn) {
        setDefaultBtn.addEventListener('click', async () => {
            presets.forEach(p => p.isDefault = false);
            presets[index].isDefault = true;

            const storageKey = type === 'context' ? 'contextPresets' : 'followupPresets';
            const defaultKey = type === 'context' ? 'defaultContextPresetId' : 'defaultFollowupPresetId';

            await chrome.storage.local.set({
                [storageKey]: presets,
                [defaultKey]: preset.id
            });
            renderPresets(type);
            showStatus('Preset set as default', 'success');
        });
    }
}

async function loadModels() {
    const modelSelect = document.getElementById('default-model');
    const { cachedModels: cached, defaultModel } = await chrome.storage.local.get(['cachedModels', 'defaultModel']);

    if (cached && cached.length > 0) {
        cachedModels = cached;
        populateDefaultModelSelect(cachedModels, defaultModel);
    } else {
        const defaultModels = [
            'gemini-2.0-flash-exp',
            'gemini-2.0-flash-thinking-exp-01-21',
            'gemini-exp-1206',
            'gemini-1.5-pro',
            'gemini-1.5-flash'
        ];
        cachedModels = defaultModels;
        populateDefaultModelSelect(defaultModels, defaultModel);
    }
}

function populateDefaultModelSelect(models, selectedModel) {
    const modelSelect = document.getElementById('default-model');
    modelSelect.innerHTML = '';

    models.forEach(model => {
        const option = document.createElement('option');
        const displayName = stripModelPrefix(model);
        option.value = model;
        option.textContent = displayName;
        if (model === selectedModel || displayName === selectedModel) {
            option.selected = true;
        }
        modelSelect.appendChild(option);
    });
}

async function fetchModelsFromAPI() {
    const provider = document.getElementById('api-provider').value;

    if (provider === 'google') {
        await fetchModelsFromGoogle();
    } else {
        await fetchModelsFromOpenAI();
    }
}

async function fetchModelsFromGoogle() {
    const apiKey = document.getElementById('api-key').value;

    if (!apiKey) {
        showStatus('Enter API key before loading models', 'error');
        return;
    }

    showStatus('Loading models...', 'info');

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
        );

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        const textModels = data.models
            .filter(model =>
                model.supportedGenerationMethods &&
                model.supportedGenerationMethods.includes('generateContent')
            )
            .map(model => model.name)
            .sort();

        if (textModels.length === 0) {
            throw new Error('No suitable models found');
        }

        cachedModels = textModels;
        await chrome.storage.local.set({ cachedModels: textModels });

        const currentModel = document.getElementById('default-model').value;
        populateDefaultModelSelect(textModels, currentModel);

        renderPresets();

        showStatus(`Loaded ${textModels.length} models`, 'success');

    } catch (error) {
        console.error('Error loading models:', error);
        showStatus(`Error loading models: ${error.message}`, 'error');
    }
}

async function fetchModelsFromOpenAI() {
    const baseUrl = document.getElementById('openai-base-url').value.replace(/\/$/, '');
    const apiKey = document.getElementById('openai-api-key').value;

    if (!baseUrl || !apiKey) {
        showStatus('Enter Base URL and API key before loading models', 'error');
        return;
    }

    showStatus('Loading models...', 'info');

    try {
        const response = await fetch(`${baseUrl}/models`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // OpenAI list models format: { data: [{ id: "...", ... }, ...] }
        let textModels = [];
        if (data.data && Array.isArray(data.data)) {
            textModels = data.data.map(model => model.id).sort();
        } else {
            // Fallback if structure is different
             throw new Error('Invalid response format');
        }

        if (textModels.length === 0) {
            throw new Error('No models found');
        }

        cachedModels = textModels;
        await chrome.storage.local.set({ cachedModels: textModels });

        const currentModel = document.getElementById('default-model').value;
        populateDefaultModelSelect(textModels, currentModel);

        renderPresets();

        showStatus(`Loaded ${textModels.length} models`, 'success');

    } catch (error) {
        console.error('Error loading models:', error);
        showStatus(`Error loading models: ${error.message}`, 'error');
    }
}

async function testAPIKey() {
    const provider = document.getElementById('api-provider').value;

    if (provider === 'google') {
        const apiKey = document.getElementById('api-key').value;

        if (!apiKey) {
            showStatus('Enter API key', 'error');
            return;
        }

        showStatus('Testing API key...', 'info');

        try {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
            );

            if (!response.ok) {
                if (response.status === 400) {
                    throw new Error('Invalid API key format');
                } else if (response.status === 403) {
                    throw new Error('API key is invalid or does not have necessary permissions');
                } else {
                    throw new Error(`HTTP ${response.status}`);
                }
            }

            showStatus('✅ API key works correctly!', 'success');
            await fetchModelsFromAPI();

        } catch (error) {
            console.error('Error testing API key:', error);
            showStatus(`❌ Error: ${error.message}`, 'error');
        }
    } else {
        const baseUrl = document.getElementById('openai-base-url').value;
        const apiKey = document.getElementById('openai-api-key').value;

        if (!baseUrl || !apiKey) {
            showStatus('Enter Base URL and API key', 'error');
            return;
        }

        showStatus('Testing API key...', 'info');
        try {
             // We can just try to fetch models to verify the key
            await fetchModelsFromOpenAI();
            showStatus('✅ API key works correctly!', 'success');
        } catch (error) {
             // fetchModelsFromOpenAI handles errors but we catch here to be sure
             // Do nothing as error is already shown by fetchModelsFromOpenAI
        }
    }
}

function setupEventListeners() {
    document.getElementById('api-provider').addEventListener('change', (e) => {
        const provider = e.target.value;
        toggleProviderSettings(provider);

        // Clear models when provider changes as they are likely incompatible
        const modelSelect = document.getElementById('default-model');
        modelSelect.innerHTML = '<option value="">Provider changed - please refresh models</option>';
        cachedModels = [];
    });

    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', () => {
            const tabName = button.dataset.tab;
            switchTab(tabName);
        });
    });

    document.getElementById('color-theme').addEventListener('change', (e) => {
        currentSettings.colorTheme = e.target.value;
        applyTheme();
    });

    document.getElementById('font-size').addEventListener('change', (e) => {
        currentSettings.fontSize = e.target.value;
        applyTheme();
    });

    document.getElementById('font-family').addEventListener('change', (e) => {
        currentSettings.fontFamily = e.target.value;
        applyTheme();
    });

    document.getElementById('add-context-preset-button').addEventListener('click', () => {
        addNewPreset('context');
    });

    document.getElementById('add-followup-preset-button').addEventListener('click', () => {
        addNewPreset('followup');
    });

    document.getElementById('restore-context-defaults-button').addEventListener('click', async () => {
        await restoreDefaultPresets('context');
    });

    document.getElementById('restore-followup-defaults-button').addEventListener('click', async () => {
        await restoreDefaultPresets('followup');
    });

    document.getElementById('refresh-models-button').addEventListener('click', fetchModelsFromAPI);
    document.getElementById('test-api-button').addEventListener('click', testAPIKey);
    document.getElementById('test-openai-api-button').addEventListener('click', testAPIKey);
    document.getElementById('save-button').addEventListener('click', saveSettings);

    document.getElementById('reset-button').addEventListener('click', async () => {
        if (!confirm('Are you sure? This will reset all settings to default values.')) {
            return;
        }

        await chrome.storage.local.clear();
        chrome.runtime.sendMessage({ action: 'reinitialize' });
        showStatus('Settings reset. Reload the page.', 'info');

        setTimeout(() => {
            location.reload();
        }, 1500);
    });
}

function switchTab(tabName) {
    activeTab = tabName;

    document.querySelectorAll('.tab-button').forEach(button => {
        if (button.dataset.tab === tabName) {
            button.classList.add('active');
        } else {
            button.classList.remove('active');
        }
    });

    document.querySelectorAll('.tab-content').forEach(content => {
        if (content.id === `tab-${tabName}`) {
            content.classList.add('active');
        } else {
            content.classList.remove('active');
        }
    });
}

function addNewPreset(type) {
    const presets = type === 'context' ? contextPresets : followupPresets;

    const newPreset = {
        id: generateId(),
        name: 'New Preset',
        systemPrompt: 'Enter your system prompt here...',
        temperature: 1.0,
        thinkingBudget: -1,
        model: null,
        isDefault: presets.length === 0
    };

    presets.push(newPreset);
    renderPresets(type);

    setTimeout(() => {
        const lastPreset = document.querySelector(`[data-preset-id="${newPreset.id}"]`);
        if (lastPreset) {
            lastPreset.querySelector('.edit-preset-btn').click();
            lastPreset.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, 100);
}

async function restoreDefaultPresets(type) {
    const presetType = type === 'context' ? 'context presets' : 'follow-up presets';

    if (!confirm(`Restore default ${presetType}? This will reset to factory defaults.`)) {
        return;
    }

    try {
        await chrome.runtime.sendMessage({ action: 'restoreDefaultPresets' });
        await loadPresets();

        showStatus(`✅ Default ${presetType} restored!`, 'success');
    } catch (error) {
        console.error('Error restoring presets:', error);
        showStatus('Error restoring presets. Try reloading extension.', 'error');
    }
}

async function saveSettings() {
    try {
        const apiProvider = document.getElementById('api-provider').value;
        const apiKey = document.getElementById('api-key').value.trim();
        const openaiBaseUrl = document.getElementById('openai-base-url').value.trim();
        const openaiApiKey = document.getElementById('openai-api-key').value.trim();

        const defaultModel = document.getElementById('default-model').value;
        const fontSize = document.getElementById('font-size').value;
        const fontFamily = document.getElementById('font-family').value;
        const colorTheme = document.getElementById('color-theme').value;

        if (apiProvider === 'google' && !apiKey) {
            showStatus('Google API key is required', 'error');
            return;
        }

        if (apiProvider === 'openai') {
            if (!openaiBaseUrl) {
                showStatus('OpenAI Base URL is required', 'error');
                return;
            }
            if (!openaiApiKey) {
                showStatus('OpenAI API key is required', 'error');
                return;
            }
        }

        if (!defaultModel) {
            showStatus('Select a model', 'error');
            return;
        }

        const defaultContextPreset = contextPresets.find(p => p.isDefault);
        const defaultFollowupPreset = followupPresets.find(p => p.isDefault);

        await chrome.storage.local.set({
            apiProvider,
            apiKey,
            openaiBaseUrl,
            openaiApiKey,
            defaultModel,
            defaultContextPresetId: defaultContextPreset ? defaultContextPreset.id : (contextPresets[0]?.id || null),
            defaultFollowupPresetId: defaultFollowupPreset ? defaultFollowupPreset.id : (followupPresets[0]?.id || null),
            fontSize,
            fontFamily,
            colorTheme,
            contextPresets,
            followupPresets
        });

        showStatus('✅ Settings saved successfully!', 'success');

    } catch (error) {
        console.error('Save error:', error);
        showStatus(`Save error: ${error.message}`, 'error');
    }
}

function showStatus(message, type = 'info') {
    const statusEl = document.getElementById('status-message');
    statusEl.textContent = message;
    statusEl.className = `status-message ${type} show`;

    setTimeout(() => {
        statusEl.classList.remove('show');
    }, 5000);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
