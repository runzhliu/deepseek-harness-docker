#!/usr/bin/env bash
set -Eeuo pipefail

dsh_version="${1:?missing DSH version}"
image_version="${2:?missing image version}"
pnpm_version="${3:?missing pnpm version}"
market_version="${4:?missing market version}"
market_image_version="${5:?missing market image version}"

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
require_literal Dockerfile.market "ARG BASE_IMAGE=runzhliu/deepseek-harness:${image_version}"
require_literal Dockerfile.market "ARG DSH_MARKET_VERSION=${market_version}"
require_literal Dockerfile.market "ARG MARKET_IMAGE_VERSION=${market_image_version}"
require_literal compose.yaml "DSH_IMAGE_VERSION:-${image_version}"
require_literal compose.market.yaml "MARKET_IMAGE_VERSION:-${market_image_version}"
require_literal .env.example "DSH_VERSION=${dsh_version}"
require_literal .env.example "DSH_IMAGE_VERSION=${image_version}"
require_literal .env.example "PNPM_VERSION=${pnpm_version}"
require_literal charts/deepseek-harness/Chart.yaml "appVersion: \"${dsh_version}\""
require_literal charts/deepseek-harness/Chart.yaml "image: runzhliu/deepseek-harness:${image_version}"
require_literal charts/deepseek-harness/values.yaml "tag: ${image_version}"
require_literal scripts/smoke.sh "runzhliu/deepseek-harness:${image_version}"
require_literal .github/workflows/ci.yml "IMAGE_VERSION=${image_version}"
require_literal .github/workflows/ci.yml "MARKET_IMAGE_VERSION=${market_image_version}"
require_literal .github/workflows/ci.yml "${dsh_version} ${pnpm_version} ${market_version}"
require_literal .github/workflows/publish-ghcr.yml "default: ${image_version}"
require_literal .github/workflows/upstream-dsh.yml "./scripts/check-upstream-dsh.sh ${dsh_version}"
require_literal README.md "runzhliu/deepseek-harness:${image_version}"
require_literal README.md "runzhliu/deepseek-harness:${market_image_version}"
require_literal README.en.md "runzhliu/deepseek-harness:${image_version}"
require_literal README.en.md "runzhliu/deepseek-harness:${market_image_version}"
require_literal SKILL.md "runzhliu/deepseek-harness:${image_version}"

printf 'versions are consistent: image=%s dsh=%s pnpm=%s market=%s\n' \
  "${image_version}" "${dsh_version}" "${pnpm_version}" "${market_version}"
