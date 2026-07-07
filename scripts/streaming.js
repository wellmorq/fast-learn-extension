async function readGeminiStream(response, onContent) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');

    let buffer = '';
    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;

    const handleLine = line => {
        if (!line.startsWith('data: ')) return;

        const jsonStr = line.substring(6).trim();
        if (!jsonStr || jsonStr === '[DONE]') return;

        try {
            const data = JSON.parse(jsonStr);
            if (data && data.usageMetadata) {
                inputTokens = data.usageMetadata.promptTokenCount || inputTokens;
                outputTokens = data.usageMetadata.candidatesTokenCount || outputTokens;
            }

            const candidate = data?.candidates?.[0];
            if (!candidate) return;

            let contentChanged = false;
            if (candidate.finishReason && candidate.finishReason !== 'STOP') {
                console.warn('Gemini finish reason:', candidate.finishReason);
                if (candidate.finishReason === 'SAFETY') {
                    fullContent += '\n\n⚠️ _Response was stopped for safety reasons._';
                    contentChanged = true;
                }
            }

            let chunkText = '';
            for (const part of candidate.content?.parts || []) {
                if (part.thought) continue;
                if (part.text) chunkText += part.text;
            }

            if (chunkText) {
                fullContent += chunkText;
                contentChanged = true;
            }

            if (contentChanged) {
                onContent(fullContent);
            }
        } catch (error) {
            console.warn('Chunk parsing error:', error);
        }
    };

    while (true) {
        const { value, done } = await reader.read();
        if (done) {
            buffer += decoder.decode();
            if (buffer.trim()) handleLine(buffer);
            break;
        }

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            handleLine(line);
        }
    }

    return { content: fullContent, usage: { inputTokens: inputTokens, outputTokens: outputTokens } };
}

function buildReasoningDisplayMarkdown(reasoning, content) {
    if (!reasoning) return content;
    if (!content) return `<think>${reasoning}`;
    return `<think>${reasoning}</think>\n\n${content}`;
}

async function readOpenAICompatibleStream(response, onContent) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');

    let buffer = '';
    let fullContent = '';
    let fullReasoning = '';
    let inputTokens = 0;
    let outputTokens = 0;

    const handleLine = line => {
        const trimmedLine = line.trim();
        if (!trimmedLine || !trimmedLine.startsWith('data: ')) return;

        const jsonStr = trimmedLine.substring(6).trim();
        if (jsonStr === '[DONE]') return;

        try {
            const data = JSON.parse(jsonStr);
            if (data && data.usage) {
                inputTokens = data.usage.prompt_tokens || inputTokens;
                outputTokens = data.usage.completion_tokens || outputTokens;
            }

            const delta = data.choices?.[0]?.delta;
            if (!delta) return;

            const reasoningChunk =
                (typeof delta.reasoning_content === 'string' && delta.reasoning_content) ||
                (typeof delta.reasoning === 'string' && delta.reasoning) || '';

            if (reasoningChunk) fullReasoning += reasoningChunk;
            if (delta.content) fullContent += delta.content;

            if (reasoningChunk || delta.content) {
                onContent(buildReasoningDisplayMarkdown(fullReasoning, fullContent));
            }
        } catch (error) {
            console.warn('Chunk parsing error:', error);
        }
    };

    while (true) {
        const { value, done } = await reader.read();
        if (done) {
            buffer += decoder.decode();
            if (buffer.trim()) handleLine(buffer);
            break;
        }

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            handleLine(line);
        }
    }

    return { content: fullContent, usage: { inputTokens: inputTokens, outputTokens: outputTokens } };
}
