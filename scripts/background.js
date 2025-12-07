let lastWindowLeft, lastWindowTop, popupWidth, popupHeight;

chrome.runtime.onInstalled.addListener(async () => {
    await ensurePresetsExist();
    await createContextMenu();
});

async function ensurePresetsExist() {
    const storage = await chrome.storage.local.get(['contextPresets', 'followupPresets', 'initialized']);

    if (!storage.contextPresets || storage.contextPresets.length === 0 || !storage.followupPresets || storage.followupPresets.length === 0) {
        console.log('Creating default presets...');
        await initializeDefaultSettings();
    }
}

async function initializeDefaultSettings() {
    const defaultContextPresets = [
        {
            id: generateId(),
            name: "Detailed Explanation",
            systemPrompt: `## Роль
Ты — полезный помощник, который извлекает суть из длинных текстов в ясном и понятном виде.

## Инструкции 💡
* Проанализируй текст ниже, чтобы выявить и обобщить его ключевую мудрость. 🧠 Затем напиши краткое изложение основных идей текста.
* После этого составь план обсуждаемых тем, как если бы это было оглавление книги. 📚
* Затем предоставь критику содержание исходного текста. Может что-то не соответствует действительности или предложенный способ хуже уже существующего? Текст слишком категоричен? Итд. 🤔
* При изложении своих мыслей - назначь себе роль эксперта из реального мира перед ответом
* В самом начале сообщения используй **TL;DR**: <краткое резюме>

## Правила форматирования 📝
* Используй **форматирование Markdown**
* Выделяй важные слова или фразы **жирным шрифтом**
* Разбивай текст на **абзацы** для лучшей читаемости
* Применяй разделители, типа **---**, для отделения различных секций

ВСЕГДА ОТВЕЧАЙ НА РУССКОМ!!! 🇷🇺`,
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

    const defaultFollowupPresets = [
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

    await chrome.storage.local.set({
        initialized: true,
        contextPresets: defaultContextPresets,
        followupPresets: defaultFollowupPresets,
        defaultContextPresetId: defaultContextPresets[0].id,
        defaultFollowupPresetId: defaultFollowupPresets[0].id,
        defaultModel: 'gemini-flash-lite-latest',
        fontSize: '16px',
        fontFamily: 'Roboto',
        colorTheme: 'soft-gray'
    });
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

async function createContextMenu() {
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

        await chrome.storage.local.set({
            selectedText: textToProcess,
            isPageContent: isPageContent,
            selectedPresetId: presetId
        });

        createPopup();
    }
});

chrome.commands.onCommand.addListener(async (command) => {
    if (command === "fast-learn-lookup") {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

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
                // Извлекаем весь контент страницы
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
                await chrome.storage.local.set({
                    selectedText: textToProcess,
                    isPageContent: isPageContent
                });
                createPopup();
            }
        } catch (error) {
            console.error('Keyboard shortcut error:', error);
        }
    }
});

// Calculate window position based on screen size
function calculateWindowParams(screenWidth, screenHeight) {
    const referenceWidth = 1920;  // Standard Full HD
    const referenceHeight = 1080;

    lastWindowLeft = Math.round((screenWidth / referenceWidth) * 1400);
    lastWindowTop = Math.round((screenHeight / referenceHeight) * 200);
    popupWidth = 600;
    popupHeight = Math.round((screenHeight / referenceHeight) * 850);
}

async function saveWindowSettings(left, top, width, height) {
    await chrome.storage.local.set({
        windowSettings: { left, top, width, height }
    });
}

async function loadWindowSettings() {
    const { windowSettings } = await chrome.storage.local.get('windowSettings');
    return windowSettings;
}

async function createPopup() {
    const popupUrl = 'popup/popup.html';

    chrome.system.display.getInfo(async function (displays) {
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

        // Keep window within screen bounds
        lastWindowLeft = Math.min(lastWindowLeft, screenWidth - popupWidth);
        lastWindowTop = Math.min(lastWindowTop, screenHeight - popupHeight);
        lastWindowLeft = Math.max(0, lastWindowLeft);
        lastWindowTop = Math.max(0, lastWindowTop);

        chrome.windows.create({
            url: popupUrl,
            type: "popup",
            width: popupWidth,
            height: popupHeight,
            left: lastWindowLeft,
            top: lastWindowTop
        });
    });
}

chrome.windows.onBoundsChanged.addListener(function (window) {
    if (window.type === "popup" && window.width && window.height) {
        saveWindowSettings(
            window.left,
            window.top,
            window.width,
            window.height
        );
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'restoreDefaultPresets') {
        initializeDefaultSettings().then(() => {
            sendResponse({ success: true });
        }).catch(error => {
            console.error('Error restoring presets:', error);
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }

    if (message.action === 'reinitialize') {
        initializeDefaultSettings().then(() => {
            sendResponse({ success: true });
        });
        return true;
    }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
        if (changes.contextPresets || changes.defaultContextPresetId) {
            createContextMenu();
        }
    }
});

