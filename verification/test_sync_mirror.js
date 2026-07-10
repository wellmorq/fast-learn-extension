const fs = require('fs');
const path = require('path');

const mkEvent = () => ({ addListener: () => { } });
let createdWindowOptions = null;
let nextWindowId = 77;
let windowRemovedListener = null;
let windowBoundsChangedListener = null;

function mkStorage() {
    let data = {};
    return {
        async get(keys) {
            if (keys == null) return JSON.parse(JSON.stringify(data));
            if (typeof keys === 'string') keys = [keys];
            const out = {};
            for (const k of keys) if (k in data) out[k] = JSON.parse(JSON.stringify(data[k]));
            return out;
        },
        async set(obj) { Object.assign(data, JSON.parse(JSON.stringify(obj))); },
        async remove(keys) { (Array.isArray(keys) ? keys : [keys]).forEach(k => delete data[k]); },
        async clear() { data = {}; }
    };
}

global.importScripts = () => { };
global.chrome = {
    runtime: { onInstalled: mkEvent(), onMessage: mkEvent() },
    contextMenus: { onClicked: mkEvent(), removeAll: async () => { }, create: () => { } },
    commands: { onCommand: mkEvent() },
    action: { onClicked: mkEvent() },
    windows: {
        onRemoved: { addListener: listener => { windowRemovedListener = listener; } },
        onBoundsChanged: { addListener: listener => { windowBoundsChangedListener = listener; } },
        create: async options => {
            createdWindowOptions = options;
            return { id: nextWindowId++ };
        }
    },
    system: {
        display: {
            getInfo: async () => [{ isPrimary: true, workArea: { width: 1920, height: 1080 } }]
        }
    },
    scripting: { executeScript: async () => [] },
    storage: { local: mkStorage(), sync: mkStorage(), session: mkStorage(), onChanged: mkEvent() }
};

const root = path.join(__dirname, '..');
eval(fs.readFileSync(path.join(root, 'scripts', 'settings.js'), 'utf8'));
eval(fs.readFileSync(path.join(root, 'scripts', 'utils.js'), 'utf8'));
eval(fs.readFileSync(path.join(root, 'scripts', 'lookup_context.js'), 'utf8'));
eval(fs.readFileSync(path.join(root, 'scripts', 'background.js'), 'utf8'));

function assert(cond, msg) {
    if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
    else console.log('ok:', msg);
}

(async () => {
    await chrome.storage.local.set({
        apiProvider: 'openai',
        contextPresets: [{ id: '1', name: 'A', systemPrompt: 'x' }],
        defaultModel: 'glm-5.1',
        apiKey: 'SECRET-GOOGLE',
        openaiApiKey: 'SECRET-OPENAI'
    });
    await mirrorLocalToSync();
    const synced = await chrome.storage.sync.get(null);
    assert(synced.apiProvider === 'openai', 'apiProvider mirrored to sync');
    assert(Array.isArray(synced.contextPresets) && synced.contextPresets.length === 1, 'presets mirrored to sync');
    assert(!('apiKey' in synced) && !('openaiApiKey' in synced), 'API keys NOT mirrored');

    await mirrorLocalToSync();
    const synced2 = await chrome.storage.sync.get(null);
    assert(JSON.stringify(synced2) === JSON.stringify(synced), 'mirror is idempotent');

    await chrome.storage.local.clear();
    await restoreFromSyncIfAvailable();
    const local = await chrome.storage.local.get(null);
    assert(local.apiProvider === 'openai', 'apiProvider restored from sync');
    assert(local.contextPresets && local.contextPresets.length === 1, 'presets restored from sync');
    assert(local.initialized === true, 'initialized flag set on restore');
    assert(!('apiKey' in local), 'API key not invented on restore');

    await chrome.storage.local.set({ contextPresets: [{ id: 'local-1' }], apiProvider: 'google' });
    await restoreFromSyncIfAvailable();
    const local2 = await chrome.storage.local.get(['contextPresets', 'apiProvider']);
    assert(local2.contextPresets[0].id === 'local-1', 'restore does not clobber existing local presets');
    assert(local2.apiProvider === 'google', 'restore does not clobber existing local settings');

    await chrome.storage.local.clear();
    await initializeDefaultSettings('all');
    const defaults = await chrome.storage.local.get(['apiProvider', 'openaiBaseUrl', 'defaultModel', 'fontSize', 'fontFamily', 'colorTheme']);
    assert(defaults.apiProvider === DEFAULT_SETTINGS.apiProvider, 'factory apiProvider uses shared default');
    assert(defaults.openaiBaseUrl === DEFAULT_SETTINGS.openaiBaseUrl, 'factory Base URL uses shared default');
    assert(defaults.defaultModel === DEFAULT_SETTINGS.defaultModel, 'factory model uses shared default');
    assert(defaults.fontSize === DEFAULT_SETTINGS.fontSize, 'factory font size uses shared default');
    assert(defaults.fontFamily === DEFAULT_SETTINGS.fontFamily, 'factory font family uses shared default');
    assert(defaults.colorTheme === DEFAULT_SETTINGS.colorTheme, 'factory theme uses shared default');

    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
    chrome.scripting.executeScript = async () => [{ result: 'selected text' }];
    await runLookupOnTab({ id: 123, url: 'https://example.com/page', title: 'Example' });
    const transientLocal = await chrome.storage.local.get(TRANSIENT_CONTEXT_KEYS);
    const transientSession = await chrome.storage.session.get(null);
    const contextKey = Object.keys(transientSession).find(key => key.startsWith(LOOKUP_CONTEXT_KEY_PREFIX));
    assert(!('selectedText' in transientLocal), 'lookup text is not written to local storage');
    assert(!!contextKey, 'lookup context is stored under an isolated key');
    assert(transientSession[contextKey].selectedText === 'selected text', 'isolated lookup context contains selected text');
    assert(createdWindowOptions.url.includes(encodeURIComponent(contextKey.slice(LOOKUP_CONTEXT_KEY_PREFIX.length))), 'popup URL references its context id');
    const firstWindowKey = getLookupPopupWindowStorageKey(77);
    assert(transientSession[firstWindowKey] === contextKey, 'popup window owns its lookup context until close');

    const contextId = contextKey.slice(LOOKUP_CONTEXT_KEY_PREFIX.length);
    const consumed = await takeLookupContext(contextId);
    const afterConsume = await chrome.storage.session.get(contextKey);
    assert(consumed.sourceUrl === 'https://example.com/page', 'popup receives its source URL');
    assert(!(contextKey in afterConsume), 'popup context is removed after consumption');

    const firstContextId = await storeLookupContext({ selectedText: 'first' });
    const secondContextId = await storeLookupContext({ selectedText: 'second' });
    const firstContext = await takeLookupContext(firstContextId);
    const secondContext = await takeLookupContext(secondContextId);
    assert(firstContextId !== secondContextId, 'concurrent popup contexts use different keys');
    assert(firstContext.selectedText === 'first' && secondContext.selectedText === 'second', 'concurrent popup contexts do not overwrite each other');

    const orphanContextId = await openLookupPopup({ selectedText: 'orphan' });
    const orphanContextKey = getLookupContextStorageKey(orphanContextId);
    const secondWindowKey = getLookupPopupWindowStorageKey(78);
    assert(await isLookupPopupWindow(77), 'first popup remains registered after a second popup opens');
    assert(await isLookupPopupWindow(78), 'second popup is registered independently');

    await windowBoundsChangedListener({ id: 77, type: 'popup', left: 10, top: 20, width: 610, height: 820 });
    await new Promise(resolve => setTimeout(resolve, 550));
    const savedWindowSettings = await chrome.storage.local.get('windowSettings');
    assert(savedWindowSettings.windowSettings.left === 10, 'earlier concurrent popup can still persist its bounds');

    await windowRemovedListener(78);
    const afterOrphanClose = await chrome.storage.session.get([orphanContextKey, secondWindowKey, firstWindowKey]);
    assert(!(orphanContextKey in afterOrphanClose), 'unconsumed popup context is removed when its window closes');
    assert(!(secondWindowKey in afterOrphanClose), 'closed popup ownership entry is removed');
    assert(firstWindowKey in afterOrphanClose, 'closing one popup does not unregister another');

    await windowRemovedListener(77);
    const afterFirstClose = await chrome.storage.session.get(firstWindowKey);
    assert(!(firstWindowKey in afterFirstClose), 'consumed popup ownership entry is removed on close');

    await chrome.storage.local.clear();
    const customContextPresets = [{ id: 'custom-context', name: 'Custom', systemPrompt: 'Keep me', isDefault: true }];
    await chrome.storage.local.set({
        apiProvider: 'google',
        fontSize: '20px',
        contextPresets: customContextPresets,
        defaultContextPresetId: 'custom-context'
    });
    await ensureDefaultSettingsExist();
    const repaired = await chrome.storage.local.get(null);
    assert(repaired.apiProvider === 'google', 'repair preserves provider');
    assert(repaired.fontSize === '20px', 'repair preserves UI settings');
    assert(repaired.contextPresets[0].id === 'custom-context', 'repair preserves existing context presets');
    assert(repaired.followupPresets.length > 0, 'repair creates only the missing follow-up presets');

    await chrome.storage.local.clear();
    await chrome.storage.sync.clear();
    await chrome.storage.local.set({
        apiProvider: 'google',
        contextPresets: customContextPresets,
        defaultContextPresetId: 'custom-context'
    });
    await chrome.storage.sync.set({
        apiProvider: 'openai',
        followupPresets: [{ id: 'synced-followup', name: 'Synced', systemPrompt: 'Synced', isDefault: true }],
        defaultFollowupPresetId: 'synced-followup'
    });
    await restoreFromSyncIfAvailable();
    const merged = await chrome.storage.local.get(null);
    assert(merged.apiProvider === 'google', 'sync restore does not replace local provider');
    assert(merged.contextPresets[0].id === 'custom-context', 'sync restore does not replace local presets');
    assert(merged.followupPresets[0].id === 'synced-followup', 'sync restore fills missing preset collection');

    console.log(process.exitCode ? 'TESTS FAILED' : 'ALL TESTS PASSED');
})();
