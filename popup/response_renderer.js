function renderResponseContent(content, element) {
    if (renderStreamingThinkingOnly(content, element)) return;

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

function renderStreamingThinkingOnly(content, element) {
    const match = /^<think(?:ing)?>([\s\S]*)$/i.exec(content || '');
    if (!match || !element) return false;

    // Keep the scroll container alive while reasoning streams; replacing it on
    // every chunk resets scroll and breaks browser autoscroll.
    const thinkingText = match[1].trim();
    let contentEl = element.querySelector('.thinking-block[data-streaming-thinking="true"] .thinking-content');

    if (!contentEl) {
        element.innerHTML = '';

        const details = document.createElement('details');
        details.className = 'thinking-block';
        details.open = true;
        details.dataset.streamingThinking = 'true';

        const summary = document.createElement('summary');
        summary.textContent = '💭 Thinking...';

        contentEl = document.createElement('div');
        contentEl.className = 'thinking-content';

        details.appendChild(summary);
        details.appendChild(contentEl);
        element.appendChild(details);
    }

    const shouldStickToBottom = isNearScrollBottom(contentEl);
    const previousTop = contentEl.scrollTop;
    contentEl.textContent = thinkingText;

    if (shouldStickToBottom) {
        scrollToBottom(contentEl);
    } else {
        contentEl.scrollTop = previousTop;
    }

    return true;
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
