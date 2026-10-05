#!/usr/bin/env bash
set -Eeuo pipefail

image="${1:-docker.io/runzhliu/deepseek-harness:0.2.1-alpha.1-r1-bwrap.1}"

actual_variant="$(docker image inspect --format '{{ index .Config.Labels "io.github.runzhliu.deepseek-harness.variant" }}' "${image}")"
if [[ "${actual_variant}" != bubblewrap-sandbox ]]; then
  echo "expected bubblewrap-sandbox image variant, got ${actual_variant:-missing label}" >&2
  exit 1
fi

docker run --rm \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=128m \
  --tmpfs /workspace:rw,nosuid,nodev,size=128m,uid=1000,gid=1000 \
  --tmpfs /outside:rw,nosuid,nodev,size=16m,uid=1000,gid=1000 \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --security-opt seccomp=unconfined \
  --security-opt systempaths=unconfined \
  --pids-limit 128 \
  --entrypoint sh \
  "${image}" -ec '
    test "$(id -u)" = 1000
    command -v bwrap >/dev/null
    bwrap \
      --ro-bind / / \
      --dev /dev \
      --unshare-pid \
      --proc /proc \
      --die-with-parent \
      --tmpfs /tmp \
      --bind /workspace /workspace \
      -- /bin/sh -ec '\''
        printf BWRAP_WORKSPACE_OK >/workspace/result
        if touch /outside/escaped 2>/dev/null; then
          echo "bubblewrap allowed a write outside /workspace" >&2
          exit 1
        fi
      '\''
    test "$(cat /workspace/result)" = BWRAP_WORKSPACE_OK
    test ! -e /outside/escaped
  '

echo "bubblewrap sandbox boundary passed for ${image}: /workspace writable, other writable outer mounts denied"
