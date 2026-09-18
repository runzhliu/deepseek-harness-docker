#!/usr/bin/env bash
set -Eeuo pipefail

image="${1:-docker.io/runzhliu/deepseek-harness:0.1.6-alpha.2-r1}"
expected_dsh_version="${2:-0.1.6-alpha.2}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "${script_dir}/.." && pwd)"
temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/dsh-podman-smoke.XXXXXX")"
workspace_dir="${temporary_dir}/workspace"
project="dsh-podman-smoke-${RANDOM}-$$"

mkdir -p "${workspace_dir}"

free_port() {
  python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()'
}

export DSH_IMAGE_REPOSITORY="${image%:*}"
export DSH_IMAGE_VERSION="${image##*:}"
export DSH_WORKSPACE="${workspace_dir}"
export DSH_PORT="$(free_port)"
export DSH_DESKTOP_PORT="$(free_port)"

if ! command -v podman-compose >/dev/null 2>&1; then
  echo "podman-compose is required for the rootless smoke test" >&2
  exit 1
fi

podman_compose_version_output="$(podman-compose version 2>&1)"
if [[ ! "${podman_compose_version_output}" =~ podman-compose[[:space:]]version:?[[:space:]]+([0-9]+)\.([0-9]+)\.([0-9]+) ]]; then
  echo "could not determine podman-compose version: ${podman_compose_version_output}" >&2
  exit 1
fi
if (( BASH_REMATCH[1] < 1 || (BASH_REMATCH[1] == 1 && BASH_REMATCH[2] < 6) )); then
  echo "podman-compose 1.6.0 or newer is required; found ${BASH_REMATCH[1]}.${BASH_REMATCH[2]}.${BASH_REMATCH[3]}" >&2
  exit 1
fi

compose=(
  podman-compose
  -p "${project}"
  -f "${project_dir}/compose.yaml"
  -f "${project_dir}/compose.podman.yaml"
)

cleanup() {
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf -- "${temporary_dir}"
}
trap cleanup EXIT INT TERM

if [[ "$(podman info --format '{{.Host.Security.Rootless}}')" != true ]]; then
  echo "podman smoke must run as an ordinary rootless user" >&2
  exit 1
fi

podman image exists "${image}"
actual_dsh_version="$(podman run --rm --entrypoint dsh "${image}" --version)"
if [[ "${actual_dsh_version}" != "${expected_dsh_version}" ]]; then
  echo "unexpected DSH version: ${actual_dsh_version}" >&2
  exit 1
fi

"${compose[@]}" config >/dev/null
"${compose[@]}" up --detach --no-build

container="$("${compose[@]}" ps --quiet)"
if [[ -z "${container}" ]]; then
  echo "rootless Compose did not create the DSH container" >&2
  exit 1
fi

health=""
for _ in $(seq 1 60); do
  health="$(podman inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "${container}")"
  if [[ "${health}" == healthy ]]; then
    break
  fi
  if [[ "$(podman inspect --format '{{.State.Status}}' "${container}")" != running ]]; then
    echo "rootless DSH container exited before becoming healthy" >&2
    podman logs "${container}" >&2 || true
    exit 1
  fi
  sleep 2
done
if [[ "${health}" != healthy ]]; then
  echo "rootless DSH container did not become healthy" >&2
  podman logs "${container}" >&2 || true
  exit 1
fi

if [[ "$(podman exec "${container}" id -u)" != 1000 ]]; then
  echo "rootless deployment did not retain the image's non-root UID 1000" >&2
  exit 1
fi
if [[ -n "$(podman exec "${container}" node -e 'process.stdout.write(process.env.NODE_ENV ?? "")')" ]]; then
  echo "rootless deployment unexpectedly injected NODE_ENV" >&2
  exit 1
fi

podman exec "${container}" node -e '
  const fs = require("node:fs")
  fs.writeFileSync("/workspace/.podman-write-test", "workspace-ok\n")
  fs.writeFileSync("/home/node/.dsh/.podman-persistence-test", "state-ok\n")
'
if [[ ! -f "${workspace_dir}/.podman-write-test" ]]; then
  echo "rootless DSH could not write through the workspace bind mount" >&2
  exit 1
fi
if [[ "$(stat -c '%u' "${workspace_dir}/.podman-write-test")" != "$(id -u)" ]]; then
  echo "rootless workspace write was not mapped back to the invoking host user" >&2
  exit 1
fi

if [[ "$(curl --silent --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:${DSH_PORT}/")" != 401 ]]; then
  echo "rootless Web endpoint did not preserve DSH authentication" >&2
  exit 1
fi
curl --fail --silent --output /dev/null "http://127.0.0.1:${DSH_DESKTOP_PORT}/vnc.html"

web_binding="$(podman port "${container}" 3080/tcp)"
desktop_binding="$(podman port "${container}" 6080/tcp)"
if [[ "${web_binding}" != 127.0.0.1:* || "${desktop_binding}" != 127.0.0.1:* ]]; then
  echo "rootless ports escaped loopback: web=${web_binding} desktop=${desktop_binding}" >&2
  exit 1
fi

"${compose[@]}" restart deepseek-harness >/dev/null
for _ in $(seq 1 30); do
  if podman exec "${container}" test -f /home/node/.dsh/.podman-persistence-test 2>/dev/null; then
    echo "rootless Podman smoke passed: keep-id bind writes, persistent state, healthy Web/noVNC, and loopback-only ports"
    exit 0
  fi
  sleep 1
done

echo "rootless Podman named-volume state did not survive restart" >&2
exit 1
