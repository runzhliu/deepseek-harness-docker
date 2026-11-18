# README screenshots

The four screenshots show DSH `0.2.2-rc.4` in Light mode. Each capture used a disposable container with an empty workspace and no configured model.

| Screenshot | Image variant | What it shows |
| --- | --- | --- |
| `deepseek-harness-web.png` | Market | New session in the demo workspace |
| `browser-desktop-webui.png` | Market | Container Chromium displaying the upstream RC4 release inside the noVNC panel |
| `plugin-market-webui.png` | Market | Plugin discovery and compatibility information |
| `deepseek-harness-superagent.png` | Super Agent | The initial overview with processing paused |

The Web, browser and market screenshots were captured at 1440 × 900 and Super Agent at 1440 × 1000, using Playwright and Chrome on the local Docker host. The [capture record](capture-provenance.json) identifies the images, capture times and runtime checks.

To refresh these assets, dispatch the [README screenshot workflow](../.github/workflows/capture-readme.yml) and the [Super Agent screenshot workflow](../.github/workflows/capture-superagent.yml) for the same published version and revision. Review the PNGs and combine both capture records before updating the README captions.
