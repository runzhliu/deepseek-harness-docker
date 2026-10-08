# Assets

All three screenshots were captured on **2026-10-08**, using the actual Web UI in **Light** mode at **1440 × 900** pixels. A headless Playwright browser captured clean, temporary containers; the user's existing deployment, model configuration, workspaces, and sessions were not used or changed.

| Asset | Image / component | View |
| --- | --- | --- |
| `deepseek-harness-web.png` | `runzhliu/deepseek-harness:0.2.1-alpha.1-r1` | New-session page with an empty `demo-project` workspace, Plugins, and Automation tasks. |
| `browser-desktop-webui.png` | Same default image; `@runzhliu/dsh-browser-desktop@0.1.5` | Real container Chromium opening the public `deepseek-ai/deepseek-harness` GitHub repository inside the movable, resizable desktop panel. |
| `plugin-market-webui.png` | `runzhliu/deepseek-harness:0.2.1-alpha.1-r1-market.1`; `dshmarket@1.66.9` | Settings → Plugin market → Discover. This optional community market is not included in the default image. |

## Capture notes

- Use disposable containers with temporary DSH state and an empty demonstration workspace; do not reuse personal volumes or provider credentials.
- Accept the first-run notice, defer provider setup, select Light in Settings, and open the empty `demo-project` workspace through the normal UI.
- For the desktop view, navigate the container's Chromium to the public upstream repository. Move and resize the overlay with its normal controls; both Harness and the GitHub page use a light theme.
- For the market view, wait for the catalog and compatibility indicators to load. Do not install a plugin merely to take the screenshot. Catalog entries, metrics, and compatibility indicators are a dated snapshot, not an endorsement or an installation test.
- Capture only the page viewport, excluding the host browser's address bar and temporary launch token. Inspect each PNG for secrets, internal endpoints, private paths, and UI errors before replacing the README assets.

The model name shown by the UI is its default selection, not evidence of a configured provider or successful inference. No API credentials, personal session content, model responses, or internal service endpoints are present. These are unaltered application screenshots, not generated mockups.
