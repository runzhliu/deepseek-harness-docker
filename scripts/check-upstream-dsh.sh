#!/usr/bin/env bash
set -Eeuo pipefail

pinned_version="${1:-0.1.1-rc.2}"
upstream_repository="${DSH_UPSTREAM_REPOSITORY:-deepseek-ai/deepseek-harness}"
npm_package="${DSH_NPM_PACKAGE:-@deepseek-ai/dsh}"

for required_command in gh jq npm; do
  if ! command -v "${required_command}" >/dev/null 2>&1; then
    echo "required command is unavailable: ${required_command}" >&2
    exit 2
  fi
done

if ! latest_release_json="$(gh api "repos/${upstream_repository}/releases?per_page=1")"; then
  echo "could not query GitHub Releases for ${upstream_repository}" >&2
  exit 2
fi
latest_tag="$(jq -r '.[0].tag_name // empty' <<<"${latest_release_json}")"
latest_release_url="$(jq -r '.[0].html_url // empty' <<<"${latest_release_json}")"

if [[ -z "${latest_tag}" || "${latest_tag}" != dsh-v* ]]; then
  echo "could not resolve the latest dsh-v* release from ${upstream_repository}" >&2
  exit 2
fi

latest_release_version="${latest_tag#dsh-v}"
if ! latest_npm_version="$(npm view "${npm_package}" version)"; then
  echo "could not query npm for ${npm_package}" >&2
  exit 2
fi

printf 'Pinned DSH:          %s\n' "${pinned_version}"
printf 'Latest npm:         %s\n' "${latest_npm_version}"
printf 'Latest GitHub tag:  %s\n' "${latest_tag}"
printf 'Latest release URL: %s\n' "${latest_release_url}"

if [[ "${latest_npm_version}" != "${pinned_version}" ]]; then
  echo "A newer npm dist-tag is available: ${npm_package}@${latest_npm_version}" >&2
  exit 1
fi

if npm view "${npm_package}@${latest_release_version}" version >/dev/null 2>&1; then
  if [[ "${latest_release_version}" != "${pinned_version}" ]]; then
    echo "The latest upstream release is now installable from npm: ${npm_package}@${latest_release_version}" >&2
    exit 1
  fi
  echo "Pinned DSH matches the latest upstream release and npm package."
else
  echo "Latest upstream release is not yet available from npm; retaining ${pinned_version}."
fi
