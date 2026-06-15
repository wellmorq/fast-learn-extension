// Node smoke test for background.js sync mirroring (run: node verification/test_sync_mirror.js)
const fs = require('fs');
const path = require('path');

const mkEvent = () => ({ addListener: () => { } });

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
    windows: { onRemoved: mkEvent(), onBoundsChanged: mkEvent(), create: () => { } },
    system: { display: { getInfo: () => { } } },
    scripting: { executeScript: async () => [] },
    storage: { local: mkStorage(), sync: mkStorage(), session: mkStorage(), onChanged: mkEvent() }
};

const root = path.join(__dirname, '..');
eval(fs.readFileSync(path.join(root, 'scripts', 'utils.js'), 'utf8'));
eval(fs.readFileSync(path.join(root, 'scripts', 'background.js'), 'utf8'));

function assert(cond, msg) {
    if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
    else console.log('ok:', msg);
}

(async () => {
    // 1. mirror: settings go to sync, API keys do NOT
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

    // 2. idempotent: second mirror writes nothing new (no throw, same state)
    await mirrorLocalToSync();
    const synced2 = await chrome.storage.sync.get(null);
    assert(JSON.stringify(synced2) === JSON.stringify(synced), 'mirror is idempotent');

    // 3. restore on a "fresh machine": empty local + populated sync
    await chrome.storage.local.clear();
    await restoreFromSyncIfAvailable();
    const local = await chrome.storage.local.get(null);
    assert(local.apiProvider === 'openai', 'apiProvider restored from sync');
    assert(local.contextPresets && local.contextPresets.length === 1, 'presets restored from sync');
    assert(local.initialized === true, 'initialized flag set on restore');
    assert(!('apiKey' in local), 'API key not invented on restore');

    // 4. restore is a no-op when local already has presets
    await chrome.storage.local.set({ contextPresets: [{ id: 'local-1' }], apiProvider: 'google' });
    await restoreFromSyncIfAvailable();
    const local2 = await chrome.storage.local.get(['contextPresets', 'apiProvider']);
    assert(local2.contextPresets[0].id === 'local-1', 'restore does not clobber existing local presets');
    assert(local2.apiProvider === 'google', 'restore does not clobber existing local settings');

    console.log(process.exitCode ? 'TESTS FAILED' : 'ALL TESTS PASSED');
})();
