function extractPageContent() {
    try {
        const documentClone = document.cloneNode(true);

        const reader = new Readability(documentClone, {
            charThreshold: 500,
            keepClasses: false
        });

        const article = reader.parse();

        if (!article) {
            return {
                success: false,
                error: 'Failed to extract page content. Try selecting text manually.'
            };
        }

        const turndownService = new TurndownService({
            headingStyle: 'atx',
            hr: '---',
            bulletListMarker: '-',
            codeBlockStyle: 'fenced',
            emDelimiter: '*'
        });
        turndownService.addRule('cleanParagraphs', {
            filter: ['p'],
            replacement: function (content) {
                return content.trim() + '\n';
            }
        });

        turndownService.addRule('cleanDivs', {
            filter: ['div'],
            replacement: function (content, node) {
                if (node.querySelector('p, h1, h2, h3, h4, h5, h6, ul, ol, pre, blockquote')) {
                    return content;
                }
                return content.trim() + '\n';
            }
        });

        turndownService.remove(['script', 'style', 'iframe', 'noscript', 'nav', 'footer', 'aside']);

        let markdown = turndownService.turndown(article.content);
        markdown = cleanMarkdown(markdown);

        let result = '';
        if (article.title) {
            result += `# ${article.title}\n`;
        }
        if (article.byline) {
            result += `*${article.byline}*\n`;
        }
        result += markdown;

        return {
            success: true,
            content: result,
            title: article.title || document.title,
            excerpt: article.excerpt || '',
            length: result.length
        };

    } catch (error) {
        console.error('Content extraction error:', error);
        return {
            success: false,
            error: `Page processing error: ${error.message}`
        };
    }
}

function cleanMarkdown(markdown) {
    if (!markdown) return '';

    let cleaned = markdown.replace(/\n{3,}/g, '\n\n');
    cleaned = cleaned.replace(/[ \t]+$/gm, '');
    cleaned = cleaned.replace(/  +/g, ' ');
    cleaned = cleaned.trim();

    return cleaned;
}

extractPageContent();

