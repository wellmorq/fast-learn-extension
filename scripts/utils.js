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
    if (num < 0.5) return 0.5;
    if (num > 1.5) return 1.5;
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

