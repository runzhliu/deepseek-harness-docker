#!/usr/bin/env bash

set -euo pipefail

source_readme="${1:-README.md}"
target_readme="${2:-README.dockerhub.md}"
max_bytes=25000

if [[ ! -f "${source_readme}" ]]; then
  echo "README source not found: ${source_readme}" >&2
  exit 1
fi

temporary_readme="$(mktemp)"
trap 'rm -f "${temporary_readme}"' EXIT

# Docker Hub limits repository overviews to 25,000 bytes. Keep README.md as
# the source of truth and compact its long architecture/deployment guides in
# the generated overview. The sync action completes relative GitHub URLs.
awk '
  /^## DeepSeek Harness 深入分析$/ {
    skip = 1
    next
  }

  /^## 快速开始$/ {
    skip = 0
    print "> Docker Hub 展示页由 GitHub README 自动生成；完整的架构分析请阅读 [GitHub 仓库 README](https://github.com/runzhliu/deepseek-harness-docker#readme)。"
    print ""
    print
    next
  }

  /^### Rootless Podman$/ {
    compact = 1
    print
    print "见 [完整文档](https://github.com/runzhliu/deepseek-harness-docker)。"
    print ""
    next
  }

  /^### 可选的 Super Agent 预装镜像$/ {
    compact = 1
    superagent = 1
    print
    print "预装上游研究原型，首次启动关闭处理与来源；使用独立项目和数据卷。"
    print ""
    print "```bash"
    print "DSH_PORT=3082 DSH_DESKTOP_PORT=6082 make superagent-pull"
    print "DSH_PORT=3082 DSH_DESKTOP_PORT=6082 make superagent-up"
    print "```"
    print ""
    print "配置、权限边界和固定源码版本见 [Super Agent 安装说明](https://github.com/runzhliu/deepseek-harness-docker#可选的-super-agent-预装镜像)。"
    print ""
    next
  }

  /^### 独立安装浏览器插件$/ {
    compact = 1
    print
    print "浏览器插件也可单独安装；打包命令、兼容版本与依赖边界见 [插件文档](https://github.com/runzhliu/deepseek-harness-docker/tree/main/plugins/dsh-browser-desktop#readme)。"
    print ""
    next
  }

  /^### 可选的 HTTPS 局域网访问$/ {
    compact = 1
    print
    print "使用 Caddy HTTPS + Basic Auth 保留 DSH 认证与同源校验；配置、证书及网络边界见 [LAN 安装说明](https://github.com/runzhliu/deepseek-harness-docker#可选的-https-局域网访问)。"
    print ""
    next
  }

  compact && /^### / {
    compact = 0
    superagent = 0
  }

  superagent && /^镜像 / {
    print
    print ""
    next
  }

  /^### 浏览器桌面、官方 Browser Use 与人工接管$/ {
    browser = 1
    print
    print "镜像把官方 Playwright MCP Browser Use attach 到同一个持久化 Chromium；插件负责 noVNC 可视桌面与人工接管，详见 [完整浏览器说明](https://github.com/runzhliu/deepseek-harness-docker#浏览器桌面官方-browser-use-与人工接管)。"
    print ""
    next
  }

  browser && /^#### / {
    browser = 0
  }

  /^## 文件$/ {
    layout = 1
    print
    print "完整目录结构见 [GitHub README](https://github.com/runzhliu/deepseek-harness-docker#文件)。"
    print ""
    print "本目录是社区实现，不代表 DeepSeek 官方发布的容器镜像。"
    next
  }

  !skip && !compact && !browser && !layout {
    print
  }
' "${source_readme}" >"${temporary_readme}"

readme_bytes="$(wc -c <"${temporary_readme}" | tr -d '[:space:]')"
if (( readme_bytes > max_bytes )); then
  echo "Docker Hub overview is ${readme_bytes} bytes; limit is ${max_bytes}" >&2
  exit 1
fi

cp "${temporary_readme}" "${target_readme}"
echo "Rendered ${target_readme} (${readme_bytes} bytes)"
