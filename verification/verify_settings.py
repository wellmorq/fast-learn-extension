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
                        // Return default settings
                        return {
                            apiProvider: 'google',
                            apiKey: 'test-key',
                            openaiBaseUrl: 'https://openrouter.ai/api/v1',
                            openaiApiKey: '',
                            fontSize: '16px',
                            fontFamily: 'Roboto',
                            colorTheme: 'soft-gray',
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

    # Take screenshot of default state (Google selected)
    page.screenshot(path="verification/1_google_settings.png")

    # Verify Google settings are visible and OpenAI settings are hidden
    expect(page.locator("#google-settings-section")).to_be_visible()
    expect(page.locator("#openai-settings-section")).to_be_hidden()

    # Change provider to OpenAI
    provider_select.select_option("openai")

    # Trigger change event just in case (select_option usually does, but to be safe)
    provider_select.dispatch_event('change')

    # Verify Google settings are hidden and OpenAI settings are visible
    expect(page.locator("#google-settings-section")).to_be_hidden()
    expect(page.locator("#openai-settings-section")).to_be_visible()

    # Verify Default OpenAI Base URL
    base_url_input = page.locator("#openai-base-url")
    expect(base_url_input).to_have_value("https://openrouter.ai/api/v1")

    # Take screenshot of OpenAI state
    page.screenshot(path="verification/2_openai_settings.png")

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
