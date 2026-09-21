# `@runzhliu/dsh-browser-desktop`

A visible Chromium desktop and human-takeover layer for DeepSeek Harness Browser Use. It embeds a real, persistent browser in a movable and resizable noVNC panel and registers the small `browser_open` bridge so an Agent can reveal the same browser to the user.

This plugin complements the official browser features instead of replacing them:

| Layer | Responsibility |
| --- | --- |
| DSH Sidebar Browser | Lightweight iframe tabs for embeddable HTTP(S) pages; it does not expose model tools. |
| DSH Browser Use | Model-facing inspection and interaction through Playwright MCP, Chrome DevTools MCP, or Stagehand. |
| Browser Desktop | Browser lifecycle, persistent profile, visible desktop, and human takeover for pages that need a real browser. |

Use official Browser Use tools for navigation, inspection, clicking, and extraction. Use `browser_open` when a user explicitly asks to open, see, or take over a URL. This division avoids maintaining a second browser-automation API.

The plugin is only the Harness integration layer. It expects two companion services:

- a Chromium DevTools endpoint, defaulting to `http://127.0.0.1:9222` from the Harness host process;
- a browser-accessible noVNC page, defaulting to port `6080` and `/vnc.html`.

The parent [`deepseek-harness-docker`](https://github.com/runzhliu/deepseek-harness-docker) project provides Chromium, Xvfb, Openbox, x11vnc, websockify, and the required lifecycle supervision. Installing this npm package alone does not install or start that desktop stack or an official Browser Use provider.

## Official Browser Use attachment

The reference image mounts the official Playwright MCP provider in attachment mode:

```yaml
- id: browser-use
  name: '@deepseek-ai/dsh-browser-use'
- id: browser-use-playwright-mcp
  name: '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp'
  config:
    mode: attach
    endpoint: 'http://127.0.0.1:9222'
```

The model and the noVNC panel therefore operate the same Chromium tabs, cookies, and persisted login state. DSH currently gives one live Session exclusive ownership of an attached browser within one provider instance. Other Sessions continue without Browser Use until the owner releases it; `browser_open` and manual desktop access remain available. If Chromium restarts, create or resume a Session after the CDP endpoint is healthy because the experimental provider does not reconnect a disconnected Session automatically.

## Install

After the package is published:

```bash
dsh plugin --profile web add @runzhliu/dsh-browser-desktop
```

For local package testing:

```bash
npm pack ./plugins/dsh-browser-desktop --pack-destination /tmp
dsh plugin --profile web add /tmp/runzhliu-dsh-browser-desktop-0.1.3.tgz
```

Version `0.1.3` retains the client-module compatibility introduced in `0.1.2` and clarifies its Browser Use / human-takeover role. Keep using plugin `0.1.1` with the older DSH `0.1.0`/`0.1.1` release-candidate client runtime. The package declares a DSH bundle patch, so `dsh plugin` adds the host and Web client halves together. Restart the Web profile after installation.

## Configuration

The bundle defaults work with the companion Docker image. Override its Cordis entry when the desktop stack uses different endpoints:

```yaml
- id: browser-desktop
  name: '@runzhliu/dsh-browser-desktop'
  config:
    cdpBaseUrl: 'http://127.0.0.1:9222'
    desktopPort: 6080
    desktopPath: '/vnc.html?autoconnect=1&resize=scale&view_only=0&reconnect=1'
    pollIntervalMs: 750
```

`desktopPort` is the port reachable by the user's browser, which may differ from the container port after port mapping.

## Security

This plugin controls a real browser and its noVNC service has no authentication in the reference image. Keep both Harness and noVNC bound to host loopback. Do not expose them directly to a LAN or the Internet.

## Discovery and publishing

Official DeepSeek Harness discovers community plugins through npm/GitHub and the `dsh-plugin` topic. The parent container repository also documents an explicitly optional third-party `dshmarket` image variant, but that market is neither an official DeepSeek service nor a substitute for publishing a normal DSH bundle. Before publishing, follow the official [bundle publishing guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md), run `npm pack --dry-run`, publish the scoped package with public access, and add the GitHub topic `dsh-plugin` to the repository.

## License

MIT
