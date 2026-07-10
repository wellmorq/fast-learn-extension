function renderStreamingResponse(reasoning, content, element) {
    if (!element) return;

    let shell = element.querySelector('.streaming-response');
    if (!shell) {
        element.innerHTML = '';
        shell = createStreamingResponseShell();
        element.appendChild(shell);
    }

    const details = shell.querySelector('.thinking-block');
    const summary = details.querySelector('summary');
    const thinkingContent = details.querySelector('.thinking-content');
    const answer = shell.querySelector('.streaming-answer');
    const thinkingText = String(reasoning || '').trim();

    if (thinkingContent.textContent !== thinkingText) {
        const shouldStickToBottom = isNearScrollBottom(thinkingContent);
        const previousTop = thinkingContent.scrollTop;
        thinkingContent.textContent = thinkingText;

        if (shouldStickToBottom) {
            scrollToBottom(thinkingContent);
        } else {
            thinkingContent.scrollTop = previousTop;
        }
    }

    const hasAnswer = !!content;
    summary.textContent = hasAnswer ? '💭 Thought Process' : '💭 Thinking...';
    answer.hidden = !hasAnswer;

    if (hasAnswer) {
        answer.innerHTML = sanitizeRenderedHtml(marked.parse(content));
    }
}

function createStreamingResponseShell() {
    const shell = document.createElement('div');
    shell.className = 'streaming-response';

    const details = document.createElement('details');
    details.className = 'thinking-block';
    details.open = true;

    const summary = document.createElement('summary');
    summary.textContent = '💭 Thinking...';

    const thinkingContent = document.createElement('div');
    thinkingContent.className = 'thinking-content';

    const answer = document.createElement('div');
    answer.className = 'streaming-answer';
    answer.hidden = true;

    details.appendChild(summary);
    details.appendChild(thinkingContent);
    shell.appendChild(details);
    shell.appendChild(answer);
    return shell;
}

function finalizeStreamingResponse(element) {
    const summary = element?.querySelector('.streaming-response .thinking-block summary');
    if (summary) summary.textContent = '💭 Thought Process';
}

function renderResponseContent(content, element) {

    const thinkingBlocks = [];
    let processedContent = content;
    const thinkingScroll = collectThinkingScrollState(element);

    const closedThinkingRegex = /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi;
    processedContent = processedContent.replace(closedThinkingRegex, (match, thinkingContent) => {
        const id = `THINKING_BLOCK_${thinkingBlocks.length}_PLACEHOLDER`;
        thinkingBlocks.push({
            id: id,
            content: thinkingContent.trim(),
            isOpen: false
        });
        return `\n\n${id}\n\n`;
    });

    const openThinkingRegex = /<think(?:ing)?>([\s\S]*?)$/i;
    const openMatch = openThinkingRegex.exec(processedContent);

    if (openMatch) {
        const thinkingContent = openMatch[1];
        const id = `THINKING_BLOCK_${thinkingBlocks.length}_PLACEHOLDER`;

        processedContent = processedContent.substring(0, openMatch.index) + `\n\n${id}\n\n`;

        thinkingBlocks.push({
            id: id,
            content: thinkingContent.trim(),
            isOpen: true
        });
    }

    let html = marked.parse(processedContent);

    thinkingBlocks.forEach((block, index) => {
        const escapedBlock = block.content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

        const summaryText = block.isOpen ? '💭 Thinking...' : '💭 Thought Process';
        const detailsAttribute = block.isOpen ? ' open' : '';

        const thinkingHtml = `
      <details class="thinking-block"${detailsAttribute} data-thinking-index="${index}">
        <summary>${summaryText}</summary>
        <div class="thinking-content">${escapedBlock}</div>
      </details>
    `;

        html = html.replace(block.id, () => thinkingHtml);
    });

    html = sanitizeRenderedHtml(html);
    element.innerHTML = html;
    restoreThinkingScrollState(element, thinkingScroll);
}

function collectThinkingScrollState(element) {
    if (!element) return [];
    return [...element.querySelectorAll('.thinking-content')].map(contentEl => ({
        top: contentEl.scrollTop,
        stickToBottom: isNearScrollBottom(contentEl)
    }));
}

function restoreThinkingScrollState(element, scrollState) {
    if (!element || !scrollState || scrollState.length === 0) return;

    const contentEls = element.querySelectorAll('.thinking-content');
    contentEls.forEach((contentEl, index) => {
        const state = scrollState[index];
        if (!state) {
            scrollToBottom(contentEl);
            return;
        }

        if (state.stickToBottom) {
            scrollToBottom(contentEl);
        } else {
            contentEl.scrollTop = state.top;
        }
    });
}

function isNearScrollBottom(element) {
    if (!element) return true;
    return element.scrollHeight - element.clientHeight - element.scrollTop <= 24;
}

function scrollToBottom(element) {
    if (!element) return;
    element.scrollTop = element.scrollHeight;
}

function sanitizeRenderedHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = html;

    template.content
        .querySelectorAll('script, style, iframe, object, embed, form, input, button, textarea, select, option, base, meta, link, svg, math')
        .forEach(node => node.remove());

    template.content.querySelectorAll('*').forEach(node => {
        [...node.attributes].forEach(attr => {
            const name = attr.name.toLowerCase();
            if (name.startsWith('on') || name === 'srcdoc' || name === 'style') {
                node.removeAttribute(attr.name);
                return;
            }

            if ((name === 'href' || name === 'src') && !isSafeRenderedUrl(attr.value, name === 'src')) {
                node.removeAttribute(attr.name);
            }
        });

        if (node.tagName === 'A' && node.target === '_blank') {
            node.rel = 'noopener noreferrer';
        }
    });

    return template.innerHTML;
}

function isSafeRenderedUrl(value, allowDataImage) {
    const trimmed = String(value || '').trim();
    if (!trimmed || trimmed.startsWith('#')) return true;
    if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true;
    if (trimmed.startsWith('./') || trimmed.startsWith('../')) return true;

    try {
        const url = new URL(trimmed, window.location.href);
        const protocol = url.protocol.toLowerCase();
        if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') return true;
        return allowDataImage && protocol === 'data:' && /^data:image\/(png|jpe?g|gif|webp|avif|bmp);/i.test(trimmed);
    } catch (_) {
        return false;
    }
}
