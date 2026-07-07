from playwright.sync_api import Page, expect, sync_playwright
import os

def verify_settings_ui(page: Page):
    # Mock chrome API
    page.add_init_script("""
        window.chrome = {
            storage: {
                local: {
                    get: async (keys) => {
                        console.log('Mock storage.get called with', keys);
                        // Let options.js apply shared product defaults.
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

    # Navigate to the options page (using absolute path for local file)
    options_path = os.path.abspath('options/options.html')
    page.goto(f"file://{options_path}")

    # Verify Provider Selector exists
    provider_select = page.locator("#api-provider")
    expect(provider_select).to_be_visible()

    # Wait for initialization
    page.wait_for_timeout(500)

    # Take screenshot of default state (OpenAI-compatible selected)
    page.screenshot(path="verification/1_openai_settings.png")

    # Verify OpenAI-compatible settings are visible and Google settings are hidden
    expect(page.locator("#google-settings-section")).to_be_hidden()
    expect(page.locator("#openai-settings-section")).to_be_visible()

    # Verify default GLM/Z.AI Base URL
    base_url_input = page.locator("#openai-base-url")
    expect(base_url_input).to_have_value("https://api.z.ai/api/paas/v4")

    # Change provider to Google
    provider_select.select_option("google")

    # Trigger change event just in case (select_option usually does, but to be safe)
    provider_select.dispatch_event('change')

    # Verify Google settings are visible and OpenAI-compatible settings are hidden
    expect(page.locator("#google-settings-section")).to_be_visible()
    expect(page.locator("#openai-settings-section")).to_be_hidden()

    # Take screenshot of Google state
    page.screenshot(path="verification/2_google_settings.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_settings_ui(page)
            print("Verification successful!")
        except Exception as e:
            print(f"Verification failed: {e}")
        finally:
            browser.close()
