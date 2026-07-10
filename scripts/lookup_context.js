var LOOKUP_CONTEXT_KEY_PREFIX = 'lookupContext:';
var LOOKUP_POPUP_WINDOW_KEY_PREFIX = 'lookupPopupWindow:';

function getLookupContextStorageKey(contextId) {
    return contextId ? `${LOOKUP_CONTEXT_KEY_PREFIX}${contextId}` : '';
}

function getLookupPopupWindowStorageKey(windowId) {
    return Number.isInteger(windowId) ? `${LOOKUP_POPUP_WINDOW_KEY_PREFIX}${windowId}` : '';
}

async function storeLookupContext(context) {
    const contextId = generateId();
    const storageKey = getLookupContextStorageKey(contextId);
    await chrome.storage.session.set({ [storageKey]: context });
    return contextId;
}

async function takeLookupContext(contextId) {
    let context = {};
    const storageKey = getLookupContextStorageKey(contextId);

    if (storageKey) {
        const stored = await chrome.storage.session.get(storageKey);
        context = stored[storageKey] || {};
        await chrome.storage.session.remove(storageKey);
    }

    if (!context.selectedText) {
        const legacySession = await chrome.storage.session.get(TRANSIENT_CONTEXT_KEYS);
        context = legacySession;
    }
    await chrome.storage.session.remove(TRANSIENT_CONTEXT_KEYS);

    if (!context.selectedText) {
        const legacyLocal = await chrome.storage.local.get(TRANSIENT_CONTEXT_KEYS);
        context = legacyLocal;
    }

    await chrome.storage.local.remove(TRANSIENT_CONTEXT_KEYS);
    return context;
}

async function registerLookupPopupWindow(windowId, contextId) {
    const windowStorageKey = getLookupPopupWindowStorageKey(windowId);
    const contextStorageKey = getLookupContextStorageKey(contextId);
    if (!windowStorageKey || !contextStorageKey) {
        throw new Error('Popup window and context identifiers are required');
    }

    await chrome.storage.session.set({ [windowStorageKey]: contextStorageKey });
}

async function isLookupPopupWindow(windowId) {
    const windowStorageKey = getLookupPopupWindowStorageKey(windowId);
    if (!windowStorageKey) return false;

    const stored = await chrome.storage.session.get(windowStorageKey);
    return typeof stored[windowStorageKey] === 'string';
}

async function releaseLookupPopupWindow(windowId) {
    const windowStorageKey = getLookupPopupWindowStorageKey(windowId);
    if (!windowStorageKey) return false;

    const stored = await chrome.storage.session.get(windowStorageKey);
    const contextStorageKey = stored[windowStorageKey];
    const keysToRemove = [windowStorageKey];
    if (typeof contextStorageKey === 'string') keysToRemove.push(contextStorageKey);
    await chrome.storage.session.remove(keysToRemove);
    return typeof contextStorageKey === 'string';
}
