# `@runzhliu/dsh-browser-desktop`

A DeepSeek Harness Web plugin that embeds a real Chromium desktop in a movable, resizable noVNC panel. It also registers the `browser_open` Agent tool so a model can open an HTTP or HTTPS URL and reveal the same interactive browser to the user.

The plugin is the Harness integration layer. It expects two companion services:

- a Chromium DevTools endpoint, defaulting to `http://127.0.0.1:9222` from the Harness host process;
- a browser-accessible noVNC page, defaulting to port `6080` and `/vnc.html`.

The parent [`deepseek-harness-docker`](https://github.com/runzhliu/deepseek-harness-docker) project provides Chromium, Xvfb, Openbox, x11vnc, websockify, and the required lifecycle supervision. Installing this npm package alone does not install or start that desktop stack.

## Install

After the package is published:

```bash
dsh plugin --profile web add @runzhliu/dsh-browser-desktop
```

For local package testing:

```bash
npm pack ./plugins/dsh-browser-desktop --pack-destination /tmp
dsh plugin --profile web add /tmp/runzhliu-dsh-browser-desktop-0.1.1.tgz
```

The package declares a DSH bundle patch, so `dsh plugin` adds the host and Web client halves together. Restart the Web profile after installation.

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
