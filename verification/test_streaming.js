// Node smoke test for provider streaming parsers (run: node verification/test_streaming.js)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
eval(fs.readFileSync(path.join(root, 'scripts', 'streaming.js'), 'utf8'));

function makeResponse(chunks) {
    const encoder = new TextEncoder();
    return {
        body: new ReadableStream({
            start(controller) {
                for (const chunk of chunks) {
                    controller.enqueue(encoder.encode(chunk));
                }
                controller.close();
            }
        })
    };
}

function assert(cond, msg) {
    if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
    else console.log('ok:', msg);
}

(async () => {
    const geminiUpdates = [];
    const gemini = await readGeminiStream(makeResponse([
        'data: {"usageMetadata":{"promptTokenCount":12},"candidates":[{"content":{"parts":[{"text":"Hello "},{"thought":true,"text":"skip"}]}}]}\n',
        'data: {"usageMetadata":{"candidatesTokenCount":3},"candidates":[{"content":{"parts":[{"text":"world"}]}}]}\n',
        'data: [DONE]\n'
    ]), content => geminiUpdates.push(content));

    assert(gemini.content === 'Hello world', 'Gemini stream concatenates text parts and skips thoughts');
    assert(gemini.usage.inputTokens === 12, 'Gemini stream reads input usage');
    assert(gemini.usage.outputTokens === 3, 'Gemini stream reads output usage');
    assert(geminiUpdates.length === 2 && geminiUpdates[1] === 'Hello world', 'Gemini stream emits incremental content');

    const geminiFinalUpdates = [];
    const geminiFinal = await readGeminiStream(makeResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"Last line"}]}}]}'
    ]), content => geminiFinalUpdates.push(content));

    assert(geminiFinal.content === 'Last line', 'Gemini stream processes final unterminated SSE line');
    assert(geminiFinalUpdates[0] === 'Last line', 'Gemini final unterminated line is rendered');

    const geminiSafetyUpdates = [];
    const geminiSafety = await readGeminiStream(makeResponse([
        'data: {"candidates":[{"finishReason":"SAFETY"}]}\n'
    ]), content => geminiSafetyUpdates.push(content));

    assert(geminiSafety.content.includes('safety reasons'), 'Gemini safety finish is included in final content');
    assert(geminiSafetyUpdates.length === 1, 'Gemini safety finish is rendered without a text chunk');

    const openAIUpdates = [];
    const openAI = await readOpenAICompatibleStream(makeResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n',
        'data: {"choices":[{"delta":{"content":"Answer"}}]}\n',
        'data: {"usage":{"prompt_tokens":7,"completion_tokens":2},"choices":[{"delta":{}}]}\n',
        'data: [DONE]\n'
    ]), content => openAIUpdates.push(content));

    assert(openAI.content === 'Answer', 'OpenAI-compatible stream returns answer content only');
    assert(openAI.usage.inputTokens === 7, 'OpenAI-compatible stream reads input usage');
    assert(openAI.usage.outputTokens === 2, 'OpenAI-compatible stream reads output usage');
    assert(openAIUpdates[0] === '<think>thinking', 'OpenAI-compatible stream emits open reasoning block');
    assert(openAIUpdates[1] === '<think>thinking</think>\n\nAnswer', 'OpenAI-compatible stream closes reasoning before answer');

    const openAIFinal = await readOpenAICompatibleStream(makeResponse([
        'data: {"choices":[{"delta":{"content":"Last"}}]}'
    ]), () => {});

    assert(openAIFinal.content === 'Last', 'OpenAI-compatible stream processes final unterminated SSE line');

    console.log(process.exitCode ? 'TESTS FAILED' : 'ALL TESTS PASSED');
})();
