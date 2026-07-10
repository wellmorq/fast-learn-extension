function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function validateThinkingBudget(value) {
    const num = parseInt(value);
    if (isNaN(num)) return -1;
    if (num < -1) return -1;
    if (num > 24000) return 24000;
    return num;
}

function validateTemperature(value) {
    const num = parseFloat(value);
    if (isNaN(num)) return 1.0;
    if (num < 0) return 0;
    if (num > 2.0) return 2.0;
    return num;
}

function buildFontStack(fontFamily) {
    const primary = (fontFamily || 'Roboto').replace(/['"]/g, '');
    return `'${primary}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Tahoma, sans-serif`;
}

function stripModelPrefix(modelName) {
    if (!modelName) return '';
    return modelName.replace(/^models\//, '');
}

function addModelPrefix(modelName) {
    if (!modelName) return '';
    if (modelName.startsWith('models/')) return modelName;
    return `models/${modelName}`;
}

function modelNamesEqual(left, right) {
    if (!left || !right) return false;
    return left === right || stripModelPrefix(left) === stripModelPrefix(right);
}

function estimateTokenCount(text) {
    if (!text) return 0;
    // Approximate ASCII at 4 chars/token and non-ASCII at 3 chars/token.
    let wide = 0;
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) > 127) wide++;
    }
    const ascii = text.length - wide;
    return Math.ceil(ascii / 4 + wide / 3);
}

function isGlmModel(modelName) {
    if (!modelName || typeof modelName !== 'string') return false;
    return /^glm[-_]/i.test(modelName);
}

// Older Gemini models reject thinkingConfig.
function geminiSupportsThinking(modelName) {
    const name = stripModelPrefix(modelName || '').toLowerCase();
    return /gemini-(2\.5|[3-9])/.test(name) || name.includes('thinking');
}

function getFallbackModels(provider, defaultModel) {
    if (provider === 'google') {
        return [
            'gemini-3.5-pro',
            'gemini-3.5-flash',
            'gemini-3.5',
            'gemini-3-pro',
            'gemini-3-flash',
            'gemini-3'
        ];
    }
    const base = ['glm-5.2', 'glm-5.1', 'glm-5-turbo'];
    if (defaultModel && !base.includes(defaultModel)) base.unshift(defaultModel);
    return base;
}

function includeSelectedModel(models, selectedModel) {
    const list = Array.isArray(models) ? models.slice() : [];
    if (!selectedModel) return list;

    const isPresent = list.some(model => modelNamesEqual(model, selectedModel));
    if (!isPresent) list.unshift(selectedModel);
    return list;
}

const PROMPT_VARIABLES_HELP = '{{selectedText}}, {{pageUrl}}, {{pageTitle}}, {{date}}, {{datetime}}, {{lang}}';

function applyPromptVariables(prompt, ctx) {
    if (!prompt || typeof prompt !== 'string') return prompt;
    ctx = ctx || {};
    const now = new Date();
    const isoDate = now.toISOString().slice(0, 10);
    const isoDateTime = now.toISOString();
    const lang = (typeof navigator !== 'undefined' && navigator.language) || 'en';
    return prompt
        .replace(/\{\{\s*selectedText\s*\}\}/g, ctx.selectedText || '')
        .replace(/\{\{\s*pageUrl\s*\}\}/g, ctx.pageUrl || '')
        .replace(/\{\{\s*pageTitle\s*\}\}/g, ctx.pageTitle || '')
        .replace(/\{\{\s*date\s*\}\}/g, isoDate)
        .replace(/\{\{\s*datetime\s*\}\}/g, isoDateTime)
        .replace(/\{\{\s*lang\s*\}\}/g, lang);
}

const MODEL_CONTEXT_LIMITS = {
    'glm-5.2': 200000,
    'glm-5.1': 200000,
    'glm-5-turbo': 200000,
    'glm-5': 200000,
    'gemini-3.5': 1048576,
    'gemini-3': 1048576
};

function getModelContextLimit(modelName) {
    if (!modelName || typeof modelName !== 'string') return 32768;
    const name = stripModelPrefix(modelName).toLowerCase();
    let bestLimit = 32768;
    let bestKey = '';
    for (const key in MODEL_CONTEXT_LIMITS) {
        if (name.indexOf(key) !== -1 && key.length > bestKey.length) {
            bestLimit = MODEL_CONTEXT_LIMITS[key];
            bestKey = key;
        }
    }
    return bestLimit;
}

function parseApiErrorBody(text) {
    if (!text) return '';
    try {
        const obj = JSON.parse(text);
        if (obj && obj.error) {
            if (typeof obj.error === 'string') return obj.error;
            return obj.error.message || obj.error.code || JSON.stringify(obj.error);
        }
        return typeof obj === 'string' ? obj : JSON.stringify(obj).slice(0, 300);
    } catch (_) {
        return String(text).slice(0, 300);
    }
}
