#!/usr/bin/env bash
set -Eeuo pipefail

pinned_version="${1:-0.1.2-alpha.4}"
upstream_repository="${DSH_UPSTREAM_REPOSITORY:-deepseek-ai/deepseek-harness}"
npm_package="${DSH_NPM_PACKAGE:-@deepseek-ai/dsh}"

for required_command in gh jq npm; do
  if ! command -v "${required_command}" >/dev/null 2>&1; then
    echo "required command is unavailable: ${required_command}" >&2
    exit 2
  fi
done

if ! latest_release_json="$(gh api "repos/${upstream_repository}/releases?per_page=20")"; then
  echo "could not query GitHub Releases for ${upstream_repository}" >&2
  exit 2
fi
latest_tag="$(jq -r '[.[] | select(.draft | not) | select(.tag_name | startswith("dsh-v"))][0].tag_name // empty' <<<"${latest_release_json}")"
latest_release_url="$(jq -r --arg tag "${latest_tag}" '.[] | select(.tag_name == $tag) | .html_url' <<<"${latest_release_json}")"

if [[ -z "${latest_tag}" || "${latest_tag}" != dsh-v* ]]; then
  echo "could not resolve the latest dsh-v* release from ${upstream_repository}" >&2
  exit 2
fi

latest_release_version="${latest_tag#dsh-v}"
if ! npm_dist_tags_json="$(npm view "${npm_package}" dist-tags --json)"; then
  echo "could not query npm dist-tags for ${npm_package}" >&2
  exit 2
fi
latest_npm_version="$(jq -r '.latest // "unassigned"' <<<"${npm_dist_tags_json}")"
alpha_npm_version="$(jq -r '.alpha // "unassigned"' <<<"${npm_dist_tags_json}")"

printf 'Pinned DSH:           %s\n' "${pinned_version}"
printf 'npm latest dist-tag:  %s\n' "${latest_npm_version}"
printf 'npm alpha dist-tag:   %s\n' "${alpha_npm_version}"
printf 'Latest GitHub tag:    %s\n' "${latest_tag}"
printf 'Latest release URL:   %s\n' "${latest_release_url}"

if installable_version="$(npm view "${npm_package}@${latest_release_version}" version 2>/dev/null)"; then
  if [[ "${installable_version}" != "${latest_release_version}" ]]; then
    echo "npm returned an unexpected version for ${npm_package}@${latest_release_version}: ${installable_version}" >&2
    exit 2
  fi
  if [[ "${latest_release_version}" != "${pinned_version}" ]]; then
    echo "The latest upstream release is now installable from npm: ${npm_package}@${latest_release_version}" >&2
    exit 1
  fi
  echo "Pinned DSH matches the latest upstream release and npm package."
else
  echo "Latest upstream release is not yet available from npm; retaining ${pinned_version}."
fi
