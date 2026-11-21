#!/usr/bin/env bash
set -Eeuo pipefail

image="${1:-docker.io/runzhliu/deepseek-harness:0.2.2-rc.5-r1-bwrap.1}"

actual_variant="$(docker image inspect --format '{{ index .Config.Labels "io.github.runzhliu.deepseek-harness.variant" }}' "${image}")"
if [[ "${actual_variant}" != bubblewrap-sandbox ]]; then
  echo "expected bubblewrap-sandbox image variant, got ${actual_variant:-missing label}" >&2
  exit 1
fi

# Persistent TMPDIR: every tool call is a `bash -c`, so BASH_ENV must point
# TMPDIR at a writable directory on the workspace mount instead of the
# disposable /tmp the bwrap profile mounts. These assertions need no bwrap.
# shellcheck disable=SC2016  # $TMPDIR is expanded by the inner bash, not here
docker run --rm \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=128m \
  --tmpfs /workspace:rw,nosuid,nodev,size=128m,uid=1000,gid=1000 \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --entrypoint bash \
  "${image}" -ec '
    test "${BASH_ENV}" = /opt/deepseek-harness/bwrap-bash-env
    test "$(stat -c %a "${BASH_ENV}")" = 644
    mkdir -p /workspace/project/sub
    test "$(cd /workspace && bash -c "echo \$TMPDIR")" = /workspace/.tmp
    test "$(cd /workspace/project/sub && bash -c "echo \$TMPDIR")" = /workspace/.tmp
    ( cd /workspace && bash -ec "test -d \"\$TMPDIR\"; test -w \"\$TMPDIR\"; f=\$(mktemp); test \"\${f%/*}\" = \"\$TMPDIR\"" )
    test "$(cd /workspace && TMPDIR=/tmp bash -c "echo \$TMPDIR")" = /tmp
    for cwd in /workspace /tmp /; do
      for preset in "-u TMPDIR" "TMPDIR=/tmp" "TMPDIR=/nonexistent"; do
        out="$(cd "${cwd}" && env ${preset} bash -euo pipefail -c ":" 2>&1)"
        test -z "${out}"
        test "$(cd "${cwd}" && env ${preset} bash -x -c ":" 2>&1)" = "+ :"
      done
    done
    # The writability probe never opens an existing file: a named pipe (or a
    # directory) under the old marker name must not block or disable startup.
    rm -rf /workspace/.tmp/.dsh-tmpdir && mkfifo /workspace/.tmp/.dsh-tmpdir
    test "$(cd /workspace && timeout 10 bash -c "echo \$TMPDIR")" = /workspace/.tmp
    # Probe files are removed again, and concurrent first calls racing to
    # create .tmp all get TMPDIR (a fresh HOME, so .tmp does not exist yet).
    test "$(ls -A /workspace/.tmp | grep -c "^\.dsh-probe\.")" = 0
    mkdir /workspace/race
    for i in $(seq 20); do (cd /workspace/race && HOME=/workspace/race bash -c "echo \$TMPDIR") & done > /workspace/race.out
    wait
    test "$(grep -c -x /workspace/race/.tmp /workspace/race.out)" = 20
    test "$(ls -A /workspace/race/.tmp | grep -c "^\.dsh-probe\.")" = 0
  '

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

# TMPDIR survives between two cages, and follows a session whose workspace is a
# subdirectory of /workspace (where /workspace itself is read-only inside the
# cage). Needs a host that can run bwrap, like the boundary check above.
# shellcheck disable=SC2016  # $TMPDIR is expanded by the inner bash, not here
docker run --rm \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=128m \
  --tmpfs /workspace:rw,nosuid,nodev,size=128m,uid=1000,gid=1000 \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --security-opt seccomp=unconfined \
  --security-opt systempaths=unconfined \
  --pids-limit 128 \
  --entrypoint bash \
  "${image}" -ec '
    cage() {  # cage <bound directory> <command>
      bwrap --ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent \
        --tmpfs /tmp --bind "$1" "$1" --chdir "$1" -- bash -c "$2"
    }
    mkdir -p /workspace/project
    test "$(cage /workspace "echo \$TMPDIR")" = /workspace/.tmp
    cage /workspace "echo kept > \"\$TMPDIR/in-cage\"; touch /tmp/volatile"
    test "$(cage /workspace "cat \"\$TMPDIR/in-cage\"")" = kept
    test "$(cage /workspace "test -e /tmp/volatile && echo leaked || echo fresh")" = fresh
    test "$(cage /workspace/project "echo \$TMPDIR")" = /workspace/project/.tmp
  '

echo "bubblewrap sandbox boundary passed for ${image}: /workspace writable, other writable outer mounts denied"
echo "persistent TMPDIR passed for ${image}: <session workspace>/.tmp survives between tool calls"
