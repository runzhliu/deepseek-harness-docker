#!/usr/bin/env bash
set -Eeuo pipefail

image="${1:-runzhliu/deepseek-harness:0.1.1-rc.2-r2}"
expected_version="${2:-0.1.1-rc.2}"
expected_pnpm_version="${3:-10.15.1}"
expected_market_version="${4:-}"
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

actual_node_version="$(docker run --rm --entrypoint node "${image}" --version)"
if [[ "${actual_node_version}" != v24.* ]]; then
  echo "expected Node.js 24.x from the upstream image, got ${actual_node_version}" >&2
  exit 1
fi

inherited_node_env="$(docker run --rm --entrypoint node "${image}" -e \
  'process.stdout.write(process.env.NODE_ENV ?? "")')"
if [[ -n "${inherited_node_env}" ]]; then
  echo "the image must not inject NODE_ENV into user commands: ${inherited_node_env}" >&2
  exit 1
fi

runtime_contract="$(docker run --rm --entrypoint sh "${image}" -ec '
  . /etc/os-release
  if [ "${VERSION_CODENAME:-}" != trixie ]; then
    echo "expected Debian trixie, got ${VERSION_CODENAME:-unknown}" >&2
    exit 1
  fi
  libc_version="$(getconf GNU_LIBC_VERSION)"
  if [ "${libc_version}" != "glibc 2.41" ]; then
    echo "expected glibc 2.41, got ${libc_version}" >&2
    exit 1
  fi
  for command_name in bash cc curl file git jq less make python3 rg rsync ssh tar unzip wget xz zip; do
    if ! command -v "${command_name}" >/dev/null 2>&1; then
      echo "required coding-agent command is missing: ${command_name}" >&2
      exit 1
    fi
  done
  printf "debian=%s libc=%s tools=ok\n" "${VERSION_CODENAME}" "${libc_version}"
')"
echo "runtime contract passed for ${image} (${runtime_contract})"

if [[ -n "${expected_market_version}" ]]; then
  actual_market_version="$(docker run --rm --entrypoint node "${image}" -p \
    'require("/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/dshmarket/package.json").version')"
  if [[ "${actual_market_version}" != "${expected_market_version}" ]]; then
    echo "expected dshmarket ${expected_market_version}, got ${actual_market_version}" >&2
    exit 1
  fi
elif ! docker run --rm --entrypoint sh "${image}" -c \
  'test ! -e /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/dshmarket'; then
  echo "the default DSH image unexpectedly contains the optional community market" >&2
  exit 1
fi

if [[ -n "${expected_market_version}" ]]; then
  config="$(docker run --rm "${image}" --profile web --patch /opt/deepseek-harness/web.cordis.patch.yml --dump-config)"
else
  config="$(docker run --rm "${image}" web --patch /opt/deepseek-harness/web.cordis.patch.yml --dump-config)"
fi
if [[ "${config}" != *"host: 0.0.0.0"* && "${config}" != *"host: '0.0.0.0'"* ]]; then
  echo "container Web patch did not set host to 0.0.0.0" >&2
  exit 1
fi
if [[ -n "${expected_market_version}" ]]; then
  if [[ "${config}" != *"name: dshmarket"* ]]; then
    echo "optional market image did not load dshmarket" >&2
    exit 1
  fi
elif [[ "${config}" == *"name: dshmarket"* ]]; then
  echo "the default DSH Web patch unexpectedly loads the community market" >&2
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
if [[ -n "${expected_market_version}" ]]; then
  docker run --rm \
    --user root \
    --volume "${volume}:/home/node/.dsh" \
    --entrypoint sh \
    "${image}" -c '
      mkdir -p /home/node/.dsh/profiles/web
      printf "[]\n" >/home/node/.dsh/profiles/web/cordis.patch.yml
      chown 123456:0 /home/node/.dsh/profiles/web/cordis.patch.yml
      chmod 0644 /home/node/.dsh/profiles/web/cordis.patch.yml
      chown -R 1000:1000 /home/node/.dsh
      chown 123456:0 /home/node/.dsh/profiles/web/cordis.patch.yml
    '
fi
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

port="$(docker port "${container}" 3080/tcp | awk -F: 'NR == 1 { print $NF }')"

market_is_ready() {
  if [[ -z "${expected_market_version}" ]]; then
    return 0
  fi
  docker exec "${container}" node -e \
    "fetch('http://127.0.0.1:3080/dsh-market/status').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"
}

for attempt in $(seq 1 30); do
  if curl --fail --silent "http://127.0.0.1:${port}/" >/dev/null \
      && docker exec "${container}" node -e \
        "Promise.all([fetch('http://127.0.0.1:6080/vnc.html'), fetch('http://127.0.0.1:9222/json/version'), fetch('http://127.0.0.1:3080/browser-desktop/state')]).then(rs => { if (rs.some(r => !r.ok)) process.exit(1) }).catch(() => process.exit(1))" \
      && market_is_ready; then
    if ! curl --fail --silent "http://127.0.0.1:${port}/" \
      | grep --quiet '"id":"@runzhliu/dsh-browser-desktop"'; then
      echo "Harness boot manifest did not include the browser desktop client plugin" >&2
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
    if [[ -n "${expected_market_version}" ]]; then
      if ! curl --fail --silent "http://127.0.0.1:${port}/" \
        | grep --quiet 'dshmarket'; then
        echo "Harness boot manifest did not include the plugin market client" >&2
        exit 1
      fi
      if ! docker exec "${container}" node -e "
        fetch('http://127.0.0.1:3080/dsh-market/status')
          .then(response => response.json())
          .then(status => {
            if (status.version !== '${expected_market_version}' || status.restart !== false) process.exit(1)
          })
          .catch(() => process.exit(1))
      "; then
        echo "plugin market status did not report the pinned version with self-restart disabled" >&2
        exit 1
      fi
      market_store="$(docker exec "${container}" pnpm store path)"
      if [[ "${market_store}" != /home/node/.dsh/pnpm-store/v* ]]; then
        echo "optional market image did not use its persistent pnpm store: ${market_store}" >&2
        exit 1
      fi
      if ! docker exec "${container}" dsh-market-repair-store --check >/dev/null; then
        echo "fresh optional market profile unexpectedly needs a pnpm store migration" >&2
        exit 1
      fi
      if ! docker exec "${container}" sh -c 'test -w "$DSH_HOME/profiles/web/cordis.patch.yml"'; then
        echo "optional market entrypoint did not repair a read-only profile patch" >&2
        exit 1
      fi
      docker exec \
        --env DSH_HOME=/tmp/dsh-market-repair-test \
        --env npm_config_store_dir=/tmp/dsh-market-repair-store \
        "${container}" node -e '
          const fs = require("node:fs")
          const root = process.env.DSH_HOME
          const modules = `${root}/profiles/web/node_modules`
          fs.rmSync(root, { recursive: true, force: true })
          fs.mkdirSync(modules, { recursive: true })
          fs.mkdirSync(`${root}/local-package`)
          fs.writeFileSync(`${root}/local-package/package.json`, "{\"name\":\"local-package\",\"version\":\"1.0.0\"}\n")
          fs.writeFileSync(`${root}/profiles/web/package.json`, "{\"name\":\"market-repair-smoke\",\"private\":true,\"dependencies\":{\"local-package\":\"file:../../local-package\"}}\n")
          fs.writeFileSync(`${modules}/.modules.yaml`, "storeDir: /tmp/old-pnpm-store/v11\n")
          fs.mkdirSync(`${root}/unmanaged-plugin`)
          fs.symlinkSync(`${root}/unmanaged-plugin`, `${modules}/unmanaged-plugin`)
        '
      docker exec \
        --env DSH_HOME=/tmp/dsh-market-repair-test \
        --env npm_config_store_dir=/tmp/dsh-market-repair-store \
        "${container}" dsh-market-repair-store >/dev/null
      if ! docker exec \
        --env DSH_HOME=/tmp/dsh-market-repair-test \
        "${container}" node -e '
          const fs = require("node:fs")
          const root = process.env.DSH_HOME
          const metadata = fs.readFileSync(`${root}/profiles/web/node_modules/.modules.yaml`, "utf8")
          const backups = fs.readdirSync(`${root}/backups`)
          if (!metadata.includes("/tmp/dsh-market-repair-store/v10")) process.exit(1)
          if (fs.readlinkSync(`${root}/profiles/web/node_modules/unmanaged-plugin`) !== `${root}/unmanaged-plugin`) process.exit(1)
          if (!fs.existsSync(`${root}/profiles/web/node_modules/local-package/package.json`)) process.exit(1)
          if (backups.length !== 1 || !fs.existsSync(`${root}/backups/${backups[0]}/node_modules/.modules.yaml`)) process.exit(1)
        '; then
        echo "optional market pnpm store migration did not preserve its backup and external plugin link" >&2
        exit 1
      fi
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
    if docker logs "${container}" 2>&1 | grep --quiet 'opening the default browser'; then
      echo "dsh web attempted to open a host browser; the container command must include --no-open" >&2
      exit 1
    fi
    if [[ -n "${expected_market_version}" ]]; then
      features="Harness, optional plugin market, and noVNC desktop"
    else
      features="official Harness integration and noVNC desktop"
    fi
    echo "smoke test passed for ${image} (${features}) on 127.0.0.1:${port}"
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
