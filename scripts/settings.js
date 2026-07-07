var DEFAULT_SETTINGS = Object.freeze({
    apiProvider: 'openai',
    apiKey: '',
    openaiBaseUrl: 'https://api.z.ai/api/paas/v4',
    openaiApiKey: '',
    defaultModel: 'glm-5.2',
    fontSize: '16px',
    fontFamily: 'Roboto',
    colorTheme: 'soft-gray'
});

var SYNCED_SETTINGS_KEYS = Object.freeze([
    'apiProvider',
    'openaiBaseUrl',
    'defaultModel',
    'defaultContextPresetId',
    'defaultFollowupPresetId',
    'fontSize',
    'fontFamily',
    'colorTheme',
    'contextPresets',
    'followupPresets'
]);

var TRANSIENT_CONTEXT_KEYS = Object.freeze([
    'selectedText',
    'isPageContent',
    'selectedPresetId',
    'sourceUrl',
    'sourceTitle'
]);

function withDefaultSettings(settings) {
    return Object.assign({}, DEFAULT_SETTINGS, settings || {});
}
