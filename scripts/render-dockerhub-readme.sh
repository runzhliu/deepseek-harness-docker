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
# the source of truth and omit only its long-form architecture analysis from
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

  compact && /^### / {
    compact = 0
  }

  /^## 文件$/ {
    layout = 1
    print
    print "完整目录结构见 [GitHub README](https://github.com/runzhliu/deepseek-harness-docker#文件)。"
    print ""
    print "本目录是社区实现，不代表 DeepSeek 官方发布的容器镜像。"
    next
  }

  !skip && !compact && !layout {
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
