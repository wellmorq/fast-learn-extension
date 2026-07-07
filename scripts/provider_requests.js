function buildGeminiRequest(prepared, apiKey) {
    const requestBody = {
        contents: prepared.messages,
        generationConfig: { temperature: prepared.temperature }
    };

    if (prepared.systemPrompt) {
        requestBody.systemInstruction = {
            role: 'user',
            parts: [{ text: prepared.systemPrompt }]
        };
    }

    if (prepared.thinkingBudget !== 0 && geminiSupportsThinking(prepared.model)) {
        requestBody.generationConfig.thinkingConfig = { thinking_budget: prepared.thinkingBudget };
    }

    const model = addModelPrefix(prepared.model);
    return {
        url: `https://generativelanguage.googleapis.com/v1beta/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`,
        body: requestBody
    };
}

function buildOpenAICompatibleRequest(prepared, baseUrl) {
    const openAIMessages = [];

    if (prepared.systemPrompt) {
        openAIMessages.push({ role: 'system', content: prepared.systemPrompt });
    }

    prepared.messages.forEach(msg => {
        let role = msg.role;
        if (role === 'model') role = 'assistant';
        const content = msg.parts.map(p => p.text).join('');
        openAIMessages.push({ role: role, content: content });
    });

    const requestBody = {
        model: prepared.model,
        messages: openAIMessages,
        temperature: prepared.temperature,
        stream: true,
        stream_options: { include_usage: true }
    };

    if (isGlmModel(prepared.model)) {
        requestBody.thinking = { type: prepared.thinkingBudget === 0 ? 'disabled' : 'enabled' };
    }

    return {
        url: `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
        body: requestBody
    };
}
