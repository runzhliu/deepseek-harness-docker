#!/usr/bin/env bash
set -Eeuo pipefail

image="${1:-runzhliu/deepseek-harness:0.1.0-rc.6}"
expected_version="${2:-0.1.0-rc.6}"
suffix="${RANDOM}-$$"
container="deepseek-harness-smoke-${suffix}"
volume="deepseek-harness-smoke-home-${suffix}"

cleanup() {
  docker container rm --force "${container}" >/dev/null 2>&1 || true
  docker volume rm "${volume}" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

actual_version="$(docker run --rm "${image}" --version)"
if [[ "${actual_version}" != "${expected_version}" ]]; then
  echo "expected dsh ${expected_version}, got ${actual_version}" >&2
  exit 1
fi

config="$(docker run --rm "${image}" web --patch /opt/deepseek-harness/web.cordis.patch.yml --dump-config)"
if [[ "${config}" != *"host: 0.0.0.0"* && "${config}" != *"host: '0.0.0.0'"* ]]; then
  echo "container Web patch did not set host to 0.0.0.0" >&2
  exit 1
fi

docker run --rm --entrypoint node "${image}" -e '
  const pty = require("/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/node-pty")
  let output = ""
  const child = pty.spawn("/bin/sh", ["-lc", "printf PTY_OK"], {
    name: "xterm", cols: 80, rows: 24, cwd: "/workspace", env: process.env,
  })
  child.onData(data => { output += data })
  child.onExit(event => {
    if (event.exitCode !== 0 || output !== "PTY_OK") process.exit(1)
  })
'

docker volume create "${volume}" >/dev/null
docker run --detach \
  --name "${container}" \
  --publish 127.0.0.1::3080 \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=512m \
  --tmpfs /workspace:rw,nosuid,nodev,size=512m,uid=1000,gid=1000 \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --pids-limit 512 \
  --volume "${volume}:/home/node/.dsh" \
  "${image}" >/dev/null

port="$(docker port "${container}" 3080/tcp | awk -F: 'NR == 1 { print $NF }')"
for attempt in $(seq 1 30); do
  if curl --fail --silent "http://127.0.0.1:${port}/" >/dev/null; then
    echo "smoke test passed for ${image} on 127.0.0.1:${port}"
    exit 0
  fi
  if ! docker container inspect "${container}" >/dev/null 2>&1; then
    echo "container exited before the Web endpoint became ready" >&2
    exit 1
  fi
  sleep 1
done

docker logs "${container}" >&2
echo "Web endpoint did not become ready within 30 seconds" >&2
exit 1
