// Node smoke test for provider request builders (run: node verification/test_provider_requests.js)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
eval(fs.readFileSync(path.join(root, 'scripts', 'utils.js'), 'utf8'));
eval(fs.readFileSync(path.join(root, 'scripts', 'provider_requests.js'), 'utf8'));

function assert(cond, msg) {
    if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
    else console.log('ok:', msg);
}

const prepared = {
    model: 'glm-5.2',
    temperature: 0.7,
    thinkingBudget: 8000,
    systemPrompt: 'System',
    messages: [
        { role: 'user', parts: [{ text: 'Question' }] },
        { role: 'model', parts: [{ text: 'Answer' }] }
    ]
};

const openAI = buildOpenAICompatibleRequest(prepared, 'https://api.z.ai/api/paas/v4///');
assert(openAI.url === 'https://api.z.ai/api/paas/v4/chat/completions', 'OpenAI-compatible URL trims trailing slash');
assert(openAI.body.model === 'glm-5.2', 'OpenAI-compatible request preserves model');
assert(openAI.body.messages[0].role === 'system' && openAI.body.messages[0].content === 'System', 'OpenAI-compatible request includes system prompt');
assert(openAI.body.messages[2].role === 'assistant', 'OpenAI-compatible request maps model role to assistant');
assert(openAI.body.thinking.type === 'enabled', 'GLM thinking is enabled when budget is not zero');

const openAIDisabled = buildOpenAICompatibleRequest({ ...prepared, thinkingBudget: 0 }, 'https://api.example.test');
assert(openAIDisabled.body.thinking.type === 'disabled', 'GLM thinking is disabled when budget is zero');

const gemini = buildGeminiRequest({ ...prepared, model: 'gemini-3.5-pro' }, 'KEY');
assert(gemini.url === 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-pro:streamGenerateContent?alt=sse&key=KEY', 'Gemini URL uses models/ prefix');
assert(gemini.body.systemInstruction.parts[0].text === 'System', 'Gemini request includes system instruction');
assert(gemini.body.generationConfig.temperature === 0.7, 'Gemini request includes temperature');
assert(gemini.body.generationConfig.thinkingConfig.thinking_budget === 8000, 'Gemini request includes supported thinkingConfig');

const geminiNoThinking = buildGeminiRequest({ ...prepared, model: 'gemini-2.0-flash' }, 'KEY');
assert(!geminiNoThinking.body.generationConfig.thinkingConfig, 'Gemini request omits thinkingConfig for unsupported models');

console.log(process.exitCode ? 'TESTS FAILED' : 'ALL TESTS PASSED');
