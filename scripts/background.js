importScripts('settings.js', 'utils.js', 'lookup_context.js');

let lastWindowLeft, lastWindowTop, popupWidth, popupHeight;

chrome.runtime.onInstalled.addListener(async (details) => {
    try {
        await restoreFromSyncIfAvailable();
        await ensureDefaultSettingsExist();
        await createContextMenu();
        scheduleMirrorToSync();
        await chrome.storage.local.remove(['appLogs', 'lastTestResults', 'lastTestRunAt']);
    } catch (error) {
        console.error('onInstalled failed:', error);
    }
});

async function restoreFromSyncIfAvailable() {
    try {
        const local = await chrome.storage.local.get(SYNCED_SETTINGS_KEYS);
        const synced = await chrome.storage.sync.get(SYNCED_SETTINGS_KEYS);
        const update = {};

        for (const key of SYNCED_SETTINGS_KEYS) {
            if (hasStoredSetting(key, local[key])) continue;
            if (hasStoredSetting(key, synced[key])) update[key] = synced[key];
        }

        if (Object.keys(update).length === 0) return;

        update.initialized = true;
        await chrome.storage.local.set(update);
        console.log('Missing settings restored from chrome.storage.sync');
    } catch (error) {
        console.warn('Restore from sync failed:', error);
    }
}

function hasStoredSetting(key, value) {
    if (key === 'contextPresets' || key === 'followupPresets') {
        return Array.isArray(value) && value.length > 0;
    }
    return value !== undefined && value !== null;
}

// Local storage is authoritative; sync is a best-effort replica.
let mirrorTimer = null;

function scheduleMirrorToSync() {
    if (mirrorTimer) clearTimeout(mirrorTimer);
    mirrorTimer = setTimeout(() => {
        mirrorTimer = null;
        mirrorLocalToSync();
    }, 1000);
}

async function mirrorLocalToSync() {
    try {
        const local = await chrome.storage.local.get(SYNCED_SETTINGS_KEYS);
        const synced = await chrome.storage.sync.get(SYNCED_SETTINGS_KEYS);

        for (const key of SYNCED_SETTINGS_KEYS) {
            if (local[key] === undefined) continue;
            if (JSON.stringify(local[key]) === JSON.stringify(synced[key])) continue;
            try {
                // One oversized sync item must not block other settings.
                await chrome.storage.sync.set({ [key]: local[key] });
            } catch (error) {
                console.warn(`Sync mirror failed for "${key}":`, error.message);
            }
        }
    } catch (error) {
        console.warn('Sync mirror failed:', error.message);
    }
}

async function ensureDefaultSettingsExist() {
    const defaultSettingKeys = [
        'apiProvider',
        'openaiBaseUrl',
        'defaultModel',
        'fontSize',
        'fontFamily',
        'colorTheme'
    ];
    const storage = await chrome.storage.local.get([
        ...defaultSettingKeys,
        'contextPresets',
        'followupPresets',
        'defaultContextPresetId',
        'defaultFollowupPresetId',
        'initialized'
    ]);
    const update = {};

    for (const key of defaultSettingKeys) {
        if (!hasStoredSetting(key, storage[key])) update[key] = DEFAULT_SETTINGS[key];
    }

    let contextPresets = storage.contextPresets;
    if (!hasStoredSetting('contextPresets', contextPresets)) {
        contextPresets = getDefaultContextPresets();
        update.contextPresets = contextPresets;
    }
    if (!contextPresets.some(preset => preset.id === storage.defaultContextPresetId)) {
        update.defaultContextPresetId = contextPresets.find(preset => preset.isDefault)?.id || contextPresets[0].id;
    }

    let followupPresets = storage.followupPresets;
    if (!hasStoredSetting('followupPresets', followupPresets)) {
        followupPresets = getDefaultFollowupPresets();
        update.followupPresets = followupPresets;
    }
    if (!followupPresets.some(preset => preset.id === storage.defaultFollowupPresetId)) {
        update.defaultFollowupPresetId = followupPresets.find(preset => preset.isDefault)?.id || followupPresets[0].id;
    }

    if (storage.initialized !== true) update.initialized = true;
    if (Object.keys(update).length > 0) {
        await chrome.storage.local.set(update);
    }
}

function getDefaultContextPresets() {
    return [
        {
            id: generateId(),
            name: "Detailed Explanation",
            systemPrompt: `Ты — критичный редактор и фильтр контента. Твоя задача — проанализировать текст и сэкономить мне время.

Сделай краткий разбор по структуре:
1. **Вердикт 🚦**: Стоит ли читать полностью? (Честно напиши: это "сплошная вода", "маркетинговая статья", "база для новичков" или "уникальный контент").
2. **Суть в двух словах 🎯**: О чем текст (максимум 2 предложения).
3. **Ключевые мысли 🗝️**: 3-5 главных тезисов (самое "мясо", без воды).

## Правила форматирования
* Используй **форматирование Markdown**
* Выделяй важные слова или фразы **жирным шрифтом**
* Разбивай текст на **абзацы** для лучшей читаемости
* Применяй разделители, типа **---**, для отделения секций
* Используй уместные смайлики
* **всегда отвечай на русском языке!**`,
            temperature: 1.0,
            thinkingBudget: -1,
            model: null,
            isDefault: true
        },
        {
            id: generateId(),
            name: "Brief Summary",
            systemPrompt: `Ты — эксперт по созданию кратких и информативных резюме. Прочитай предоставленный текст и создай краткое изложение, которое:
* Содержит только самые важные моменты
* Написано простым языком
* Занимает не более 3-5 предложений
* Сохраняет ключевой смысл оригинала

Отвечай на русском языке.`,
            temperature: 0.7,
            thinkingBudget: 0,
            model: null,
            isDefault: false
        },
        {
            id: generateId(),
            name: "ELI5",
            systemPrompt: `Ты — учитель, который объясняет сложные концепции простым языком для детей. Объясни предоставленный текст так, чтобы:
* Использовать простые слова и короткие предложения
* Приводить понятные примеры из повседневной жизни
* Избегать технических терминов, или объяснять их простым языком
* Делать объяснение интересным и увлекательным

Отвечай на русском языке.`,
            temperature: 0.8,
            thinkingBudget: 0,
            model: null,
            isDefault: false
        },
        {
            id: generateId(),
            name: "Technical Analysis",
            systemPrompt: `Ты — технический эксперт с глубокими знаниями в различных областях. Проанализируй предоставленный текст с технической точки зрения:
* Определи ключевые технические концепции
* Оцени точность и актуальность информации
* Укажи на потенциальные проблемы или ограничения
* Предложи альтернативные подходы если применимо
* Используй технические термины где необходимо

Отвечай на русском языке, используй Markdown форматирование.`,
            temperature: 0.5,
            thinkingBudget: 8000,
            model: null,
            isDefault: false
        },
        {
            id: generateId(),
            name: "Translation to Russian",
            systemPrompt: `Переведи предоставленный текст на русский язык. Перевод должен быть:
* Точным и сохраняющим смысл оригинала
* Естественным и легко читаемым
* Учитывающим контекст и культурные особенности
* Профессиональным

Если текст уже на русском, просто скажи об этом.`,
            temperature: 0.3,
            thinkingBudget: 0,
            model: null,
            isDefault: false
        }
    ];
}

function getDefaultFollowupPresets() {
    return [
        {
            id: generateId(),
            name: "Conversational",
            systemPrompt: `Ты — дружелюбный и внимательный помощник в активном диалоге. Отвечай на вопросы пользователя:
* Учитывай контекст предыдущих сообщений
* Давай конкретные и полезные ответы
* Используй примеры для пояснения
* Будь лаконичным, но исчерпывающим
* Используй Markdown для форматирования

Отвечай на русском языке.`,
            temperature: 0.9,
            thinkingBudget: -1,
            model: null,
            isDefault: true
        },
        {
            id: generateId(),
            name: "Detailed Answer",
            systemPrompt: `Ты — эксперт, который даёт подробные и обоснованные ответы. При ответе на вопрос:
* Проанализируй вопрос глубоко и всесторонне
* Предоставь детальное объяснение с аргументацией
* Рассмотри разные точки зрения если применимо
* Используй структурированное форматирование (списки, заголовки)
* Приводи примеры и дополнительный контекст

Отвечай на русском языке с использованием Markdown.`,
            temperature: 0.7,
            thinkingBudget: 8000,
            model: null,
            isDefault: false
        },
        {
            id: generateId(),
            name: "Quick Answer",
            systemPrompt: `Ты — помощник, который даёт быстрые и точные ответы. Отвечай:
* Кратко и по существу
* Без лишних деталей
* Структурированно (используй списки если нужно)
* Понятным языком

Отвечай на русском языке.`,
            temperature: 0.5,
            thinkingBudget: 0,
            model: null,
            isDefault: false
        }
    ];
}

async function initializeDefaultSettings(scope = 'all') {
    const update = {};

    if (scope === 'all' || scope === 'context') {
        const presets = getDefaultContextPresets();
        update.contextPresets = presets;
        update.defaultContextPresetId = presets[0].id;
    }
    if (scope === 'all' || scope === 'followup') {
        const presets = getDefaultFollowupPresets();
        update.followupPresets = presets;
        update.defaultFollowupPresetId = presets[0].id;
    }
    if (scope === 'all') {
        update.initialized = true;
        update.apiProvider = DEFAULT_SETTINGS.apiProvider;
        update.openaiBaseUrl = DEFAULT_SETTINGS.openaiBaseUrl;
        update.defaultModel = DEFAULT_SETTINGS.defaultModel;
        update.fontSize = DEFAULT_SETTINGS.fontSize;
        update.fontFamily = DEFAULT_SETTINGS.fontFamily;
        update.colorTheme = DEFAULT_SETTINGS.colorTheme;
    }

    await chrome.storage.local.set(update);
}

let contextMenuQueue = Promise.resolve();

function createContextMenu() {
    contextMenuQueue = contextMenuQueue
        .then(buildContextMenu)
        .catch(error => console.error('Error building context menu:', error));
    return contextMenuQueue;
}

async function buildContextMenu() {
    await chrome.contextMenus.removeAll();

    const { contextPresets, defaultContextPresetId } = await chrome.storage.local.get(['contextPresets', 'defaultContextPresetId']);

    if (!contextPresets || contextPresets.length === 0) {
        console.warn('No context presets found for context menu');
        return;
    }

    chrome.contextMenus.create({
        id: "fast-learn-parent",
        title: "Explain",
        contexts: ["selection", "page"]
    });

    contextPresets.forEach(preset => {
        const isDefault = preset.isDefault || preset.id === defaultContextPresetId;
        const title = isDefault ? `${preset.name} ✨` : preset.name;

        chrome.contextMenus.create({
            id: `fast-learn-preset-${preset.id}`,
            parentId: "fast-learn-parent",
            title: title,
            contexts: ["selection", "page"]
        });
    });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId.toString().startsWith("fast-learn-preset-")) {
        const presetId = info.menuItemId.toString().replace("fast-learn-preset-", "");

        let textToProcess = '';
        let isPageContent = false;

        if (info.selectionText && info.selectionText.trim()) {
            textToProcess = info.selectionText.trim();
        } else {
            try {
                const results = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['libs/readability.min.js', 'libs/turndown.min.js', 'scripts/content.js']
                });

                if (results && results[0] && results[0].result) {
                    const result = results[0].result;
                    if (result.success) {
                        textToProcess = result.content;
                        isPageContent = true;
                    } else {
                        textToProcess = `Error: ${result.error}`;
                    }
                } else {
                    textToProcess = 'Error: Failed to extract page content.';
                }
            } catch (error) {
                console.error('Content extraction error:', error);
                textToProcess = `Error: ${error.message}`;
            }
        }

        await openLookupPopup({
            selectedText: textToProcess,
            isPageContent: isPageContent,
            selectedPresetId: presetId,
            sourceUrl: (tab && tab.url) || '',
            sourceTitle: (tab && tab.title) || ''
        });
    }
});

async function runLookupOnTab(tab) {
    try {
        const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: () => window.getSelection().toString()
        });

        let textToProcess = '';
        let isPageContent = false;

        if (result && result.trim()) {
            textToProcess = result.trim();
        } else {
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['libs/readability.min.js', 'libs/turndown.min.js', 'scripts/content.js']
            });

            if (results && results[0] && results[0].result) {
                const extractResult = results[0].result;
                if (extractResult.success) {
                    textToProcess = extractResult.content;
                    isPageContent = true;
                } else {
                    textToProcess = `Error: ${extractResult.error}`;
                }
            }
        }

        if (textToProcess) {
            await openLookupPopup({
                selectedText: textToProcess,
                isPageContent: isPageContent,
                selectedPresetId: null,
                sourceUrl: tab.url || '',
                sourceTitle: tab.title || ''
            });
        }
    } catch (error) {
        console.error('Lookup error:', error);
    }
}

chrome.commands.onCommand.addListener(async (command) => {
    if (command !== "fast-learn-lookup") return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
        console.warn('No active tab for keyboard shortcut');
        return;
    }
    await runLookupOnTab(tab);
});

chrome.action.onClicked.addListener(async (tab) => {
    if (!tab || !tab.id) return;
    await runLookupOnTab(tab);
});

function calculateWindowParams(screenWidth, screenHeight) {
    const referenceWidth = 1920;
    const referenceHeight = 1080;

    lastWindowLeft = Math.round((screenWidth / referenceWidth) * 1400);
    lastWindowTop = Math.round((screenHeight / referenceHeight) * 200);
    popupWidth = 600;
    popupHeight = Math.round((screenHeight / referenceHeight) * 850);
}

let saveBoundsTimer = null;

function saveWindowSettings(left, top, width, height) {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(() => {
        saveBoundsTimer = null;
        chrome.storage.local.set({
            windowSettings: { left, top, width, height }
        });
    }, 500);
}

async function loadWindowSettings() {
    const { windowSettings } = await chrome.storage.local.get('windowSettings');
    return windowSettings;
}

async function openLookupPopup(context) {
    const contextId = await storeLookupContext(context);
    await createPopup(contextId);
    return contextId;
}

async function createPopup(contextId) {
    const popupUrl = `popup/popup.html?context=${encodeURIComponent(contextId)}`;
    const contextStorageKey = getLookupContextStorageKey(contextId);

    try {
        const displays = await chrome.system.display.getInfo();
        const primaryDisplay = displays.find(d => d.isPrimary) || displays[0];
        const { width: screenWidth, height: screenHeight } = primaryDisplay.workArea;

        const savedSettings = await loadWindowSettings();
        if (!savedSettings) {
            calculateWindowParams(screenWidth, screenHeight);
        } else {
            lastWindowLeft = savedSettings.left;
            lastWindowTop = savedSettings.top;
            popupWidth = savedSettings.width;
            popupHeight = savedSettings.height;
        }

        lastWindowLeft = Math.min(lastWindowLeft, screenWidth - popupWidth);
        lastWindowTop = Math.min(lastWindowTop, screenHeight - popupHeight);
        lastWindowLeft = Math.max(0, lastWindowLeft);
        lastWindowTop = Math.max(0, lastWindowTop);

        const win = await chrome.windows.create({
            url: popupUrl,
            type: "popup",
            width: popupWidth,
            height: popupHeight,
            left: lastWindowLeft,
            top: lastWindowTop
        });

        if (!win) throw new Error('Chrome did not create the popup window');

        // Ownership must survive service worker restarts.
        await registerLookupPopupWindow(win.id, contextId);
        return win;
    } catch (error) {
        await chrome.storage.session.remove(contextStorageKey);
        console.error('Popup creation failed:', error.message);
        return null;
    }
}

chrome.windows.onRemoved.addListener(async (windowId) => {
    await releaseLookupPopupWindow(windowId);
});

chrome.windows.onBoundsChanged.addListener(async (window) => {
    if (window.type !== "popup" || !window.width || !window.height) return;
    if (!await isLookupPopupWindow(window.id)) return;
    saveWindowSettings(window.left, window.top, window.width, window.height);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'restoreDefaultPresets') {
        const scope = message.type === 'context' || message.type === 'followup' ? message.type : 'all';
        initializeDefaultSettings(scope).then(() => {
            sendResponse({ success: true });
        }).catch(error => {
            console.error('Error restoring presets:', error);
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }

    if (message.action === 'reinitialize') {
        initializeDefaultSettings('all').then(() => {
            sendResponse({ success: true });
        }).catch(error => {
            console.error('Error reinitializing:', error);
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName === 'local') {
        if (changes.contextPresets || changes.defaultContextPresetId) {
            createContextMenu();
        }
        if (SYNCED_SETTINGS_KEYS.some(key => changes[key])) {
            scheduleMirrorToSync();
        }
        return;
    }

    if (areaName === 'sync') {
        // Equality check prevents local/sync echo cycles.
        try {
            const local = await chrome.storage.local.get(SYNCED_SETTINGS_KEYS);
            const update = {};
            for (const key of SYNCED_SETTINGS_KEYS) {
                if (!changes[key] || changes[key].newValue === undefined) continue;
                if (JSON.stringify(changes[key].newValue) === JSON.stringify(local[key])) continue;
                update[key] = changes[key].newValue;
            }
            if (Object.keys(update).length > 0) {
                await chrome.storage.local.set(update);
            }
        } catch (error) {
            console.warn('Applying synced settings failed:', error);
        }
    }
});
