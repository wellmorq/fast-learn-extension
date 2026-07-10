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

function buildReasoningDisplayMarkdown(reasoning, content, hasReasoning = !!reasoning) {
    if (!hasReasoning) return content;
    if (!content) return `<think>${reasoning}`;
    return `<think>${reasoning}</think>\n\n${content}`;
}

function getTrailingPartialTagLength(value, tags) {
    const lowerValue = value.toLowerCase();
    const tagStart = lowerValue.lastIndexOf('<');
    if (tagStart === -1) return 0;

    const suffix = lowerValue.substring(tagStart);
    return tags.some(tag => tag.startsWith(suffix)) ? suffix.length : 0;
}

function removeThinkingAnswerSeparator(value) {
    const newlineSeparator = /^(?:[ \t]*\r?\n){1,2}/.exec(value);
    if (newlineSeparator) return value.substring(newlineSeparator[0].length);
    return value.replace(/^[ \t]+/, '');
}

function parseLeadingThinkingBlock(content, isFinal = false) {
    const source = String(content || '');
    const leadingWhitespaceLength = source.match(/^\s*/)[0].length;
    const candidate = source.substring(leadingWhitespaceLength);
    const lowerCandidate = candidate.toLowerCase();
    const openingTags = ['<thinking>', '<think>'];
    const closingTags = ['</thinking>', '</think>'];
    const openingTag = openingTags.find(tag => lowerCandidate.startsWith(tag));

    if (!openingTag) {
        const isPartialTag = lowerCandidate.startsWith('<') &&
            openingTags.some(tag => tag.startsWith(lowerCandidate));
        if (isPartialTag && !isFinal) {
            return { reasoning: '', content: '', hasReasoning: false, pending: true };
        }
        return { reasoning: '', content: source, hasReasoning: false, pending: false };
    }

    const blockContent = candidate.substring(openingTag.length);
    const closingMatch = /<\/think(?:ing)?>/i.exec(blockContent);
    if (!closingMatch) {
        const partialTagLength = getTrailingPartialTagLength(blockContent, closingTags);
        const reasoning = partialTagLength > 0
            ? blockContent.slice(0, -partialTagLength)
            : blockContent;
        return { reasoning, content: '', hasReasoning: true, pending: false };
    }

    const reasoning = blockContent.substring(0, closingMatch.index).trim();
    const answerStart = closingMatch.index + closingMatch[0].length;
    const answer = removeThinkingAnswerSeparator(blockContent.substring(answerStart));
    return { reasoning, content: answer, hasReasoning: true, pending: false };
}

function normalizeOpenAIStreamContent(structuredReasoning, rawContent, isFinal = false) {
    if (structuredReasoning) {
        return {
            reasoning: structuredReasoning,
            content: rawContent,
            hasReasoning: true,
            pending: false
        };
    }
    return parseLeadingThinkingBlock(rawContent, isFinal);
}

async function readOpenAICompatibleStream(response, onContent) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');

    let buffer = '';
    let rawContent = '';
    let fullReasoning = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let lastStateWasPending = false;

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

            const contentChunk = typeof delta.content === 'string' ? delta.content : '';
            if (reasoningChunk) fullReasoning += reasoningChunk;
            if (contentChunk) rawContent += contentChunk;

            if (reasoningChunk || contentChunk) {
                const state = normalizeOpenAIStreamContent(fullReasoning, rawContent);
                lastStateWasPending = state.pending;
                if (!state.pending) {
                    onContent(
                        buildReasoningDisplayMarkdown(state.reasoning, state.content, state.hasReasoning),
                        state
                    );
                }
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

    const finalState = normalizeOpenAIStreamContent(fullReasoning, rawContent, true);
    if (lastStateWasPending) {
        onContent(finalState.content, finalState);
    }

    return {
        content: finalState.content,
        reasoning: finalState.reasoning,
        hasReasoning: finalState.hasReasoning,
        usage: { inputTokens: inputTokens, outputTokens: outputTokens }
    };
}
