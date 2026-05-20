function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function cleanMarkdown(markdown) {
    if (!markdown) return '';

    let cleaned = markdown.replace(/\n{3,}/g, '\n\n');
    cleaned = cleaned.replace(/[ \t]+$/gm, '');
    cleaned = cleaned.trim();

    return cleaned;
}

function htmlToMarkdown(html) {
    if (typeof TurndownService === 'undefined') {
        console.error('TurndownService not loaded');
        return html;
    }

    const turndownService = new TurndownService({
        headingStyle: 'atx',
        hr: '---',
        bulletListMarker: '-',
        codeBlockStyle: 'fenced',
        emDelimiter: '*'
    });

    turndownService.addRule('cleanParagraphs', {
        filter: ['p', 'div'],
        replacement: function (content) {
            return content.trim() + '\n\n';
        }
    });

    turndownService.remove(['script', 'style', 'iframe', 'noscript']);

    const markdown = turndownService.turndown(html);
    return cleanMarkdown(markdown);
}

function formatApiError(error, status) {
    const errorMessages = {
        400: 'Invalid request. Check your settings.',
        401: 'Invalid API key. Check the key in settings.',
        403: 'Access forbidden. Check API key permissions.',
        429: 'Rate limit exceeded. Try again later.',
        500: 'Gemini server error. Try again later.',
        503: 'Gemini service temporarily unavailable.'
    };

    const message = errorMessages[status] || `Error: ${error.message}`;
    return `❌ ${message}`;
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

function stripModelPrefix(modelName) {
    if (!modelName) return '';
    return modelName.replace(/^models\//, '');
}

function addModelPrefix(modelName) {
    if (!modelName) return '';
    if (modelName.startsWith('models/')) return modelName;
    return `models/${modelName}`;
}

function estimateTokenCount(text) {
    if (!text) return 0;
    // Heuristic: ASCII tokenizes at ~4 chars/token; non-ASCII (Cyrillic, CJK,
    // accented Latin, emoji) at ~3 chars/token because BPE splits them into
    // multiple subtokens more often. This adapts naturally to mixed content
    // without needing a language switch.
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

// Provider-appropriate model list to show before a live model list is fetched.
// GLM/Z.AI is the primary provider, so the OpenAI-compatible branch lists GLM
// models (configured default first) rather than Gemini ones.
function getFallbackModels(provider, defaultModel) {
    if (provider === 'google') {
        return [
            'gemini-2.0-flash-exp',
            'gemini-2.0-flash-thinking-exp-01-21',
            'gemini-exp-1206',
            'gemini-1.5-pro',
            'gemini-1.5-flash'
        ];
    }
    const base = ['glm-5.1', 'glm-4.6', 'glm-4.5-air', 'glm-4.5', 'glm-4.5v', 'glm-4-plus', 'glm-4'];
    if (defaultModel && !base.includes(defaultModel)) base.unshift(defaultModel);
    return base;
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

// Approximate context windows by model family (used for pre-flight token warnings).
// Keys are matched as substrings against lowercased model name; longest match wins.
const MODEL_CONTEXT_LIMITS = {
    'glm-5.1': 200000,
    'glm-5': 200000,
    'glm-4.6': 200000,
    'glm-4.5-air': 128000,
    'glm-4.5v': 65536,
    'glm-4.5': 128000,
    'glm-4-plus': 128000,
    'glm-4': 128000,
    'gemini-2.0-flash': 1048576,
    'gemini-2.0': 1048576,
    'gemini-1.5-pro': 2097152,
    'gemini-1.5-flash': 1048576,
    'gemini-flash-lite': 1048576,
    'gemini-flash': 1048576,
    'gemini-pro': 32768
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