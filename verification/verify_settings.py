from pathlib import Path

from playwright.sync_api import Page, expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "verification" / "artifacts"

def verify_settings_ui(page: Page):
    page.add_init_script("""
        window.chrome = {
            storage: {
                local: {
                    get: async (keys) => {
                        console.log('Mock storage.get called with', keys);
                        return {
                            contextPresets: [],
                            followupPresets: []
                        };
                    },
                    set: async (items) => {
                        console.log('Mock storage.set called with', items);
                    },
                    clear: async () => {}
                }
            },
            runtime: {
                sendMessage: async () => {}
            }
        };
    """)

    page.goto((ROOT / "options" / "options.html").as_uri())

    provider_select = page.locator("#api-provider")
    expect(provider_select).to_be_visible()

    page.wait_for_timeout(500)

    page.screenshot(path=str(ARTIFACTS / "1_openai_settings.png"))

    expect(page.locator("#google-settings-section")).to_be_hidden()
    expect(page.locator("#openai-settings-section")).to_be_visible()

    base_url_input = page.locator("#openai-base-url")
    expect(base_url_input).to_have_value("https://api.z.ai/api/paas/v4")

    provider_select.select_option("google")

    expect(page.locator("#google-settings-section")).to_be_visible()
    expect(page.locator("#openai-settings-section")).to_be_hidden()

    page.screenshot(path=str(ARTIFACTS / "2_google_settings.png"))


def verify_streaming_renderer(page: Page):
    page.set_content("""
        <style>
            .thinking-content {
                height: 50px;
                overflow-y: auto;
                white-space: pre-wrap;
            }
        </style>
        <div id="response-content"></div>
    """)
    page.add_script_tag(path=str(ROOT / "libs" / "marked.min.js"))
    page.add_script_tag(path=str(ROOT / "popup" / "response_renderer.js"))

    result = page.evaluate(r"""() => {
        const target = document.getElementById('response-content');
        const reasoning = Array.from({ length: 80 }, (_, i) => `step ${i}`).join('\n');

        renderStreamingResponse(reasoning, '', target);
        const firstThinking = target.querySelector('.thinking-content');
        firstThinking.scrollTop = 30;
        const manualScrollTop = firstThinking.scrollTop;

        const moreReasoning = `${reasoning}\nmanual-scroll update`;
        renderStreamingResponse(moreReasoning, '', target);
        const manualScrollPreserved = firstThinking.scrollTop === manualScrollTop;

        firstThinking.scrollTop = firstThinking.scrollHeight;
        renderStreamingResponse(`${moreReasoning}\nauto-scroll update`, '', target);
        const distanceFromBottom = firstThinking.scrollHeight
            - firstThinking.clientHeight
            - firstThinking.scrollTop;

        firstThinking.scrollTop = 30;
        const beforeAnswerScrollTop = firstThinking.scrollTop;

        renderStreamingResponse(`${moreReasoning}\nauto-scroll update`, '# First answer', target);
        const afterAnswer = target.querySelector('.thinking-content');
        const firstAnswer = target.querySelector('.streaming-answer').textContent;

        renderStreamingResponse(`${moreReasoning}\nauto-scroll update`, '# First answer\n\nSecond chunk', target);
        const afterSecondChunk = target.querySelector('.thinking-content');

        return {
            sameAfterAnswer: firstThinking === afterAnswer,
            sameAfterSecondChunk: firstThinking === afterSecondChunk,
            manualScrollPreserved,
            autoScrollAtBottom: distanceFromBottom <= 1,
            scrollPreservedDuringAnswer: afterSecondChunk.scrollTop === beforeAnswerScrollTop,
            thinkingContainsAnswer: afterSecondChunk.textContent.includes('First answer'),
            firstAnswer,
            finalAnswer: target.querySelector('.streaming-answer').textContent,
            summary: target.querySelector('.thinking-block summary').textContent
        };
    }""")

    assert result["sameAfterAnswer"], "Thinking DOM node changed when answer started"
    assert result["sameAfterSecondChunk"], "Thinking DOM node changed during answer streaming"
    assert result["manualScrollPreserved"], "Manual thinking scroll position was reset"
    assert result["autoScrollAtBottom"], "Thinking content did not follow new reasoning at the bottom"
    assert result["scrollPreservedDuringAnswer"], "Thinking scroll changed when answer content streamed"
    assert not result["thinkingContainsAnswer"], "Answer was rendered inside Thinking Process"
    assert "First answer" in result["firstAnswer"], "First answer chunk was not rendered"
    assert "Second chunk" in result["finalAnswer"], "Later answer chunk was not rendered"
    assert result["summary"] == "💭 Thought Process", "Thinking summary was not finalized"

    page.screenshot(path=str(ARTIFACTS / "3_streaming_renderer.png"))

if __name__ == "__main__":
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            verify_settings_ui(browser.new_page())
            verify_streaming_renderer(browser.new_page())
            print("Verification successful!")
        finally:
            browser.close()
