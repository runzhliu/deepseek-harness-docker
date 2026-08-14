#!/usr/bin/env bash
set -Eeuo pipefail

image="${1:-runzhliu/deepseek-harness:0.1.0-rc.6}"
expected_version="${2:-0.1.0-rc.6}"
expected_pnpm_version="${3:-10.15.1}"
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

actual_pnpm_version="$(docker run --rm --entrypoint pnpm "${image}" --version)"
if [[ "${actual_pnpm_version}" != "${expected_pnpm_version}" ]]; then
  echo "expected pnpm ${expected_pnpm_version}, got ${actual_pnpm_version}" >&2
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

chromium_version="$(docker run --rm --entrypoint chromium-docker "${image}" --version)"
if [[ "${chromium_version}" != Chromium* ]]; then
  echo "expected Chromium in the runtime image, got ${chromium_version}" >&2
  exit 1
fi

browser_dom="$(docker run --rm \
  --entrypoint chromium-docker \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=512m \
  --tmpfs /workspace:rw,nosuid,nodev,size=512m,uid=1000,gid=1000 \
  --shm-size 1g \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  "${image}" \
  --headless=new \
  --dump-dom \
  'data:text/html,<main>DSH_BROWSER_OK</main>' \
  2>/dev/null)"
if [[ "${browser_dom}" != *"DSH_BROWSER_OK"* ]]; then
  echo "Chromium did not render a page under the hardened runtime settings" >&2
  exit 1
fi

docker volume create "${volume}" >/dev/null
docker run --detach \
  --name "${container}" \
  --publish 127.0.0.1::3080 \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=512m \
  --tmpfs /workspace:rw,nosuid,nodev,size=512m,uid=1000,gid=1000 \
  --shm-size 1g \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --pids-limit 512 \
  --volume "${volume}:/home/node/.dsh" \
  "${image}" >/dev/null

docker exec "${container}" sh -lc 'printf "WORKSPACE_BROWSER_OK\n" > /workspace/smoke.txt'

port="$(docker port "${container}" 3080/tcp | awk -F: 'NR == 1 { print $NF }')"
for attempt in $(seq 1 30); do
  if curl --fail --silent "http://127.0.0.1:${port}/" >/dev/null \
      && docker exec "${container}" node -e \
        "Promise.all([fetch('http://127.0.0.1:6080/vnc.html'), fetch('http://127.0.0.1:9222/json/version'), fetch('http://127.0.0.1:3080/browser-desktop/state'), fetch('http://127.0.0.1:3080/workspace-browser/list?path='), fetch('http://127.0.0.1:3080/workspace-browser/file?path=smoke.txt')]).then(rs => { if (rs.some(r => !r.ok)) process.exit(1) }).catch(() => process.exit(1))"; then
    if ! curl --fail --silent "http://127.0.0.1:${port}/" \
      | grep --quiet '"id":"@runzhliu/dsh-browser-desktop"'; then
      echo "Harness boot manifest did not include the browser desktop client plugin" >&2
      exit 1
    fi
    if ! curl --fail --silent "http://127.0.0.1:${port}/" \
      | grep --quiet '"id":"@runzhliu/dsh-workspace-browser"'; then
      echo "Harness boot manifest did not include the workspace browser client plugin" >&2
      exit 1
    fi
    if ! docker exec "${container}" node -e '
      fetch("http://127.0.0.1:3080/browser-desktop/state")
        .then(response => response.json())
        .then(state => {
          if (state.desktop.port !== 6080 || !state.desktop.path.startsWith("/vnc.html")) process.exit(1)
        })
        .catch(() => process.exit(1))
    '; then
      echo "browser desktop state did not expose its noVNC endpoint" >&2
      exit 1
    fi
    if ! docker exec "${container}" node -e '
      fetch("http://127.0.0.1:3080/browser-desktop/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "http://127.0.0.1:3080" }),
      })
        .then(response => response.json())
        .then(result => {
          if (result.status !== "opened" || result.url !== "http://127.0.0.1:3080/") process.exit(1)
        })
        .catch(() => process.exit(1))
    '; then
      echo "browser_open transport did not open a Chromium tab" >&2
      exit 1
    fi
    if ! docker exec "${container}" node -e '
      const base = "http://127.0.0.1:3080/workspace-browser"
      const json = (method, body, headers = {}) => ({
        method,
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body)
      })
      ;(async () => {
        let response = await fetch(`${base}/entry`, json("POST", { path: "crud-smoke", type: "directory" }))
        if (response.status !== 201) process.exit(1)
        response = await fetch(`${base}/entry`, json("POST", { path: "crud-smoke/file.txt", type: "file", content: "created\n" }))
        if (response.status !== 201) process.exit(1)

        let preview = await fetch(`${base}/file?path=crud-smoke%2Ffile.txt`).then(r => r.json())
        if (preview.content !== "created\n") process.exit(1)
        response = await fetch(`${base}/file`, json("PUT", {
          path: "crud-smoke/file.txt",
          content: "updated\n",
          expectedMtimeMs: preview.mtimeMs
        }))
        if (!response.ok) process.exit(1)
        response = await fetch(`${base}/entry`, json("PATCH", {
          path: "crud-smoke/file.txt",
          destinationPath: "crud-smoke/renamed.txt"
        }))
        if (!response.ok) process.exit(1)

        const listing = await fetch(`${base}/list?path=crud-smoke`).then(r => r.json())
        preview = await fetch(`${base}/file?path=crud-smoke%2Frenamed.txt`).then(r => r.json())
        if (!listing.entries.some(entry => entry.name === "renamed.txt")) process.exit(1)
        if (preview.content !== "updated\n") process.exit(1)

        response = await fetch(`${base}/entry`, json("DELETE", { path: "crud-smoke/renamed.txt" }))
        if (!response.ok) process.exit(1)
        response = await fetch(`${base}/entry`, json("DELETE", { path: "crud-smoke" }))
        if (!response.ok) process.exit(1)

        const escaped = await fetch(`${base}/file?path=..%2Fetc%2Fpasswd`)
        if (escaped.status !== 400) process.exit(1)
        const crossOrigin = await fetch(`${base}/entry`, json("POST", {
          path: "forbidden.txt",
          type: "file"
        }, { origin: "https://example.invalid" }))
        if (crossOrigin.status !== 403) process.exit(1)
      })().catch(error => {
        console.error(error)
        process.exit(1)
      })
    '; then
      echo "workspace browser CRUD or workspace boundary check failed" >&2
      exit 1
    fi
    echo "smoke test passed for ${image} (Harness, browser desktop, and workspace browser) on 127.0.0.1:${port}"
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
