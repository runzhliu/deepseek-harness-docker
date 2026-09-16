#!/usr/bin/env bash
set -Eeuo pipefail

dsh_version="${1:?missing DSH version}"
image_version="${2:?missing image version}"
pnpm_version="${3:?missing pnpm version}"
market_version="${4:?missing market version}"
market_image_version="${5:?missing market image version}"
browser_plugin_version="${6:?missing browser plugin version}"
ungoogled_chromium_version="${7:?missing ungoogled-chromium version}"
ungoogled_image_version="${8:?missing ungoogled image version}"
ungoogled_amd64_sha256="${9:?missing ungoogled-chromium amd64 sha256}"
ungoogled_arm64_sha256="${10:?missing ungoogled-chromium arm64 sha256}"
caddy_version="${11:?missing Caddy version}"

require_literal() {
  local file="$1"
  local literal="$2"
  if ! grep -F --quiet -- "${literal}" "${file}"; then
    printf 'version consistency check failed: %s does not contain %s\n' "${file}" "${literal}" >&2
    return 1
  fi
}

require_literal Dockerfile "ARG DSH_VERSION=${dsh_version}"
require_literal Dockerfile "ARG IMAGE_VERSION=${image_version}"
require_literal Dockerfile "ARG PNPM_VERSION=${pnpm_version}"
require_literal Dockerfile "ARG NODE_IMAGE=docker.io/library/node:24-trixie"
require_literal Dockerfile "ARG UNGOOGLED_CHROMIUM_VERSION=${ungoogled_chromium_version}"
require_literal Dockerfile "ARG UNGOOGLED_CHROMIUM_AMD64_SHA256=${ungoogled_amd64_sha256}"
require_literal Dockerfile "ARG UNGOOGLED_CHROMIUM_ARM64_SHA256=${ungoogled_arm64_sha256}"
require_literal Dockerfile.market "ARG NODE_IMAGE=docker.io/library/node:24-trixie"
require_literal Dockerfile.market "ARG BASE_IMAGE=docker.io/runzhliu/deepseek-harness:${image_version}"
require_literal Dockerfile.market "ARG DSH_MARKET_VERSION=${market_version}"
require_literal Dockerfile.market "ARG MARKET_IMAGE_VERSION=${market_image_version}"
require_literal compose.yaml "DSH_IMAGE_VERSION:-${image_version}"
require_literal compose.yaml 'DSH_IMAGE_REPOSITORY:-docker.io/runzhliu/deepseek-harness'
require_literal compose.yaml 'NODE_IMAGE:-docker.io/library/node:24-trixie'
require_literal compose.market.yaml "MARKET_IMAGE_VERSION:-${market_image_version}"
require_literal compose.lan.yaml "docker.io/library/caddy:${caddy_version}-alpine"
require_literal compose.podman.yaml 'userns_mode: "keep-id:uid=1000,gid=1000"'
require_literal compose.podman.yaml '${DSH_WORKSPACE:-dsh-workspace}:/workspace:Z'
require_literal .env.example "DSH_VERSION=${dsh_version}"
require_literal .env.example "DSH_IMAGE_VERSION=${image_version}"
require_literal .env.example "PNPM_VERSION=${pnpm_version}"
require_literal .env.example 'DSH_IMAGE_REPOSITORY=docker.io/runzhliu/deepseek-harness'
require_literal .env.example 'NODE_IMAGE=docker.io/library/node:24-trixie'
require_literal .env.lan.example "CADDY_IMAGE=docker.io/library/caddy:${caddy_version}-alpine"
require_literal charts/deepseek-harness/Chart.yaml "appVersion: \"${dsh_version}\""
require_literal charts/deepseek-harness/Chart.yaml "image: docker.io/runzhliu/deepseek-harness:${image_version}"
require_literal charts/deepseek-harness/values.yaml 'repository: docker.io/runzhliu/deepseek-harness'
require_literal charts/deepseek-harness/values.yaml "tag: ${image_version}"
require_literal scripts/smoke.sh "runzhliu/deepseek-harness:${image_version}"
require_literal scripts/podman-smoke.sh "docker.io/runzhliu/deepseek-harness:${image_version}"
require_literal scripts/podman-smoke.sh 'command -v podman-compose'
require_literal scripts/podman-smoke.sh 'podman-compose 1.6.0 or newer is required'
require_literal .github/workflows/ci.yml "IMAGE_VERSION=${image_version}"
require_literal .github/workflows/ci.yml "MARKET_IMAGE_VERSION=${market_image_version}"
require_literal .github/workflows/ci.yml "IMAGE_VERSION=${ungoogled_image_version}"
require_literal .github/workflows/ci.yml "UNGOOGLED_CHROMIUM_VERSION=${ungoogled_chromium_version}"
require_literal .github/workflows/ci.yml "UNGOOGLED_CHROMIUM_AMD64_SHA256=${ungoogled_amd64_sha256}"
require_literal .github/workflows/ci.yml "UNGOOGLED_CHROMIUM_ARM64_SHA256=${ungoogled_arm64_sha256}"
require_literal .github/workflows/ci.yml "${dsh_version} ${pnpm_version} ${market_version}"
require_literal .github/workflows/ci.yml './scripts/podman-smoke.sh localhost/deepseek-harness:ci-amd64'
require_literal .github/workflows/ci.yml 'podman-compose/bin/podman-compose'
require_literal .github/workflows/ci.yml 'podman-compose==1.6.0'
require_literal .github/workflows/publish-ghcr.yml "default: ${image_version}"
require_literal .github/workflows/publish-dockerhub.yml "DSH_VERSION: ${dsh_version}"
require_literal .github/workflows/publish-dockerhub.yml "IMAGE_VERSION: ${image_version}"
require_literal .github/workflows/publish-dockerhub.yml "MARKET_IMAGE_VERSION: ${market_image_version}"
require_literal .github/workflows/publish-dockerhub.yml "UNGOOGLED_IMAGE_VERSION: ${ungoogled_image_version}"
require_literal .github/workflows/upstream-dsh.yml "./scripts/check-upstream-dsh.sh ${dsh_version}"
require_literal plugins/dsh-browser-desktop/package.json "\"version\": \"${browser_plugin_version}\""
require_literal plugins/dsh-browser-desktop/package.json '"@deepseek-ai/dsh-client-modules"'
require_literal README.md "runzhliu/deepseek-harness:${image_version}"
require_literal README.md "runzhliu/deepseek-harness:${market_image_version}"
require_literal README.md "runzhliu/deepseek-harness:${ungoogled_image_version}"
require_literal README.md "ungoogled-chromium@${ungoogled_chromium_version}"
require_literal README.md "runzhliu-dsh-browser-desktop-${browser_plugin_version}.tgz"
require_literal README.md "caddy:${caddy_version}-alpine"
require_literal README.en.md "runzhliu/deepseek-harness:${image_version}"
require_literal README.en.md "runzhliu/deepseek-harness:${market_image_version}"
require_literal README.en.md "runzhliu/deepseek-harness:${ungoogled_image_version}"
require_literal README.en.md "ungoogled-chromium@${ungoogled_chromium_version}"
require_literal README.en.md "runzhliu-dsh-browser-desktop-${browser_plugin_version}.tgz"
require_literal README.en.md "caddy:${caddy_version}-alpine"
require_literal SKILL.md "runzhliu/deepseek-harness:${image_version}"
require_literal SKILL.md "${ungoogled_image_version}"
require_literal SKILL.md "caddy:${caddy_version}-alpine"
require_literal README.md 'compose.podman.yaml'
require_literal README.en.md 'compose.podman.yaml'
require_literal SKILL.md 'compose.podman.yaml'

printf 'versions are consistent: image=%s dsh=%s pnpm=%s market=%s browser-plugin=%s ungoogled-chromium=%s caddy=%s\n' \
  "${image_version}" "${dsh_version}" "${pnpm_version}" "${market_version}" "${browser_plugin_version}" "${ungoogled_chromium_version}" "${caddy_version}"
