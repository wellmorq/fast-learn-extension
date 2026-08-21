var ZAI_GENERAL_BASE_URL = 'https://api.z.ai/api/paas/v4';
var ZAI_CODING_PLAN_BASE_URL = 'https://api.z.ai/api/coding/paas/v4';
var CURRENT_SETTINGS_MIGRATION_VERSION = 1;

var DEFAULT_SETTINGS = Object.freeze({
    apiProvider: 'openai',
    apiKey: '',
    openaiBaseUrl: ZAI_CODING_PLAN_BASE_URL,
    openaiApiKey: '',
    defaultModel: 'glm-5.2',
    fontSize: '16px',
    fontFamily: 'Roboto',
    colorTheme: 'soft-gray'
});

var SYNCED_SETTINGS_KEYS = Object.freeze([
    'settingsMigrationVersion',
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
