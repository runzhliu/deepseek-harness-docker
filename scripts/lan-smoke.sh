#!/usr/bin/env bash
set -Eeuo pipefail

image_repository="${1:-runzhliu/deepseek-harness}"
image_version="${2:-0.1.7-alpha.1-r1}"
caddy_image="${CADDY_IMAGE:-caddy:2.11.4-alpine}"
lan_host="dsh-lan.test"
lan_username="smoke"
lan_password="dsh-lan-smoke-password"
suffix="${RANDOM}-$$"
project="dsh-lan-smoke-${suffix}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "${script_dir}/.." && pwd)"
temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/dsh-lan-smoke.XXXXXX")"
cookie_jar="${temporary_dir}/cookies.txt"
headers_file="${temporary_dir}/headers.txt"
body_file="${temporary_dir}/body.txt"

free_port() {
  node -e '
    const net = require("node:net")
    const server = net.createServer()
    server.listen(0, "127.0.0.1", () => {
      process.stdout.write(String(server.address().port))
      server.close()
    })
  '
}

lan_port="$(free_port)"
lan_password_hash="$(docker run --rm "${caddy_image}" caddy hash-password --plaintext "${lan_password}")"

export DSH_IMAGE_REPOSITORY="${image_repository}"
export DSH_IMAGE_VERSION="${image_version}"
export DSH_PORT=0
export DSH_DESKTOP_PORT=0
export DSH_LAN_BIND_ADDRESS=127.0.0.1
export DSH_LAN_HOST="${lan_host}"
export DSH_LAN_HTTPS_PORT="${lan_port}"
export DSH_LAN_USERNAME="${lan_username}"
export DSH_LAN_PASSWORD_HASH="${lan_password_hash}"
export CADDY_IMAGE="${caddy_image}"

compose=(
  docker compose
  --project-directory "${project_dir}"
  --project-name "${project}"
  --file "${project_dir}/compose.yaml"
  --file "${project_dir}/compose.lan.yaml"
)

cleanup() {
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -f "${cookie_jar}" "${headers_file}" "${body_file}"
  rmdir "${temporary_dir}" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

request() {
  curl --silent --show-error \
    --noproxy '*' \
    --cacert "${temporary_dir}/root.crt" \
    --resolve "${lan_host}:${lan_port}:127.0.0.1" \
    "$@"
}

"${compose[@]}" up --detach --no-build

gateway_status=""
for attempt in $(seq 1 60); do
  gateway_status="$(curl --insecure --silent --noproxy '*' --output /dev/null --write-out '%{http_code}' \
    --resolve "${lan_host}:${lan_port}:127.0.0.1" \
    "https://${lan_host}:${lan_port}/" || true)"
  if [[ "${gateway_status}" == 401 ]]; then
    break
  fi
  sleep 2
done
if [[ "${gateway_status}" != 401 ]]; then
  echo "LAN gateway did not become ready (last HTTP status: ${gateway_status:-none})" >&2
  "${compose[@]}" ps >&2 || true
  "${compose[@]}" logs --no-color >&2 || true
  exit 1
fi

gateway_container="$("${compose[@]}" ps --quiet lan-gateway)"
dsh_container="$("${compose[@]}" ps --quiet deepseek-harness)"
if ! docker exec "${gateway_container}" wget --quiet --spider \
  http://127.0.0.1:2019/config/; then
  echo "Caddy admin health probe failed" >&2
  exit 1
fi
docker cp "${gateway_container}:/data/caddy/pki/authorities/local/root.crt" \
  "${temporary_dir}/root.crt"

request --dump-header "${headers_file}" --output /dev/null \
  "https://${lan_host}:${lan_port}/"
if ! grep -Eiq '^WWW-Authenticate: Basic' "${headers_file}"; then
  echo "LAN gateway did not challenge an unauthenticated request" >&2
  exit 1
fi

status="$(request --user "${lan_username}:${lan_password}" \
  --output /dev/null --write-out '%{http_code}' \
  "https://${lan_host}:${lan_port}/")"
if [[ "${status}" != 401 ]]; then
  echo "expected DSH to reject a request without its session cookie, got HTTP ${status}" >&2
  exit 1
fi

launch_token="$(docker logs "${dsh_container}" 2>&1 \
  | sed -n 's#^dsh web: http://127\.0\.0\.1:[0-9][0-9]*/?token=\([^ ]*\).*#\1#p' \
  | tail -n 1)"
if [[ -z "${launch_token}" ]]; then
  echo "could not find the DSH launch token in container logs" >&2
  exit 1
fi

status="$(request --user "${lan_username}:${lan_password}" \
  --cookie-jar "${cookie_jar}" \
  --dump-header "${headers_file}" --output /dev/null --write-out '%{http_code}' \
  "https://${lan_host}:${lan_port}/?token=${launch_token}")"
if [[ "${status}" != 302 && "${status}" != 303 ]]; then
  echo "DSH launch-token exchange returned HTTP ${status}" >&2
  exit 1
fi
if ! grep -Eiq '^Set-Cookie: .*;[[:space:]]*Secure([;[:space:]]|$)' "${headers_file}"; then
  echo "the TLS gateway did not mark the DSH session cookie Secure" >&2
  exit 1
fi

status="$(request --user "${lan_username}:${lan_password}" \
  --cookie "${cookie_jar}" --output "${body_file}" --write-out '%{http_code}' \
  "https://${lan_host}:${lan_port}/")"
if [[ "${status}" != 200 ]]; then
  echo "authenticated DSH request returned HTTP ${status}" >&2
  exit 1
fi
if ! grep -q '"id":"@runzhliu/dsh-browser-desktop"' "${body_file}"; then
  echo "authenticated DSH response did not include the browser plugin" >&2
  exit 1
fi

status="$(request --user "${lan_username}:${lan_password}" \
  --cookie "${cookie_jar}" \
  --header "Origin: https://${lan_host}:${lan_port}" \
  --output /dev/null --write-out '%{http_code}' \
  "https://${lan_host}:${lan_port}/api/lan-smoke")"
if [[ "${status}" == 403 ]]; then
  echo "DSH did not accept the configured trusted host on its API boundary" >&2
  exit 1
fi

status="$(request --user "${lan_username}:${lan_password}" \
  --cookie "${cookie_jar}" \
  --header 'Origin: https://untrusted.example' \
  --output /dev/null --write-out '%{http_code}' \
  "https://${lan_host}:${lan_port}/api/lan-smoke")"
if [[ "${status}" != 403 ]]; then
  echo "DSH did not reject an untrusted Origin (HTTP ${status})" >&2
  exit 1
fi

request --fail --user "${lan_username}:${lan_password}" \
  --cookie "${cookie_jar}" \
  "https://${lan_host}:${lan_port}/browser-desktop/state" >"${body_file}"
desktop_path="$(node -e '
  const fs = require("node:fs")
  const state = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
  process.stdout.write(new URL(state.desktop.path, "https://dsh-lan.test").pathname)
' "${body_file}")"
if [[ ! "${desktop_path}" =~ ^/novnc-[^/]+/vnc\.html$ ]]; then
  echo "unexpected noVNC desktop path: ${desktop_path}" >&2
  exit 1
fi
status="$(request --user "${lan_username}:${lan_password}" \
  --cookie "${cookie_jar}" --output /dev/null --write-out '%{http_code}' \
  "https://${lan_host}:${lan_port}${desktop_path}")"
if [[ "${status}" != 200 ]]; then
  echo "protected same-origin noVNC request returned HTTP ${status}" >&2
  exit 1
fi
websocket_path="${desktop_path%/vnc.html}/websockify"
set +e
websocket_status="$(request --http1.1 --max-time 2 \
  --user "${lan_username}:${lan_password}" --cookie "${cookie_jar}" \
  --header 'Connection: Upgrade' \
  --header 'Upgrade: websocket' \
  --header 'Sec-WebSocket-Version: 13' \
  --header 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  --header 'Sec-WebSocket-Protocol: binary' \
  --output /dev/null --write-out '%{http_code}' \
  "https://${lan_host}:${lan_port}${websocket_path}" 2>/dev/null)"
set -e
if [[ "${websocket_status}" != 101 ]]; then
  echo "protected noVNC WebSocket upgrade returned HTTP ${websocket_status:-none}" >&2
  exit 1
fi

web_binding="$("${compose[@]}" port deepseek-harness 3080)"
desktop_binding="$("${compose[@]}" port deepseek-harness 6080)"
if [[ "${web_binding}" != 127.0.0.1:* || "${desktop_binding}" != 127.0.0.1:* ]]; then
  echo "DSH ports escaped the loopback boundary: web=${web_binding} desktop=${desktop_binding}" >&2
  exit 1
fi

echo "LAN smoke passed: TLS + Basic Auth + DSH session + same-origin noVNC; direct ports remain loopback-only"
