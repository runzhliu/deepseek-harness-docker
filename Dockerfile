# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24-trixie
FROM ${NODE_IMAGE} AS installer

ARG DSH_VERSION=0.1.1-rc.2
ARG PNPM_VERSION=10.15.1

# node-pty publishes prebuilds for only some Linux architectures. Keep the
# installer requirements explicit so linux/arm64 can fall back to node-gyp,
# even if a maintainer experiments with another NODE_IMAGE. The default
# non-slim runtime separately retains its development toolchain on purpose.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      build-essential \
      ca-certificates \
      python3 \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global --omit=dev --no-audit --no-fund \
      --allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs \
      "@deepseek-ai/dsh@${DSH_VERSION}" \
      "pnpm@${PNPM_VERSION}" \
    && test "$(dsh --version)" = "${DSH_VERSION}" \
    && test "$(pnpm --version)" = "${PNPM_VERSION}" \
    && npm cache clean --force

FROM ${NODE_IMAGE}

ARG NODE_IMAGE
ARG DSH_VERSION=0.1.1-rc.2
ARG PNPM_VERSION=10.15.1

# Use Node's official non-slim Trixie variant intentionally: its buildpack-deps
# base provides the compiler and common development utilities a coding agent or
# native plugin may need at runtime, while glibc 2.41 accepts newer binaries
# than Bookworm's glibc 2.36. Install the remaining user-facing CLI tools
# explicitly so their availability is covered by the smoke test. Chromium is
# installed from Debian so linux/amd64 and linux/arm64 stay native; Noto CJK
# keeps Chinese pages and screenshots readable.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      ca-certificates \
      chromium \
      curl \
      file \
      fonts-liberation \
      fonts-noto-cjk \
      git \
      jq \
      less \
      novnc \
      openbox \
      openssh-client \
      procps \
      python3 \
      ripgrep \
      rsync \
      tini \
      unzip \
      websockify \
      wget \
      x11-utils \
      x11vnc \
      xterm \
      xvfb \
      zip \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /usr/local/lib/node_modules/@deepseek-ai

# dsh misdetects Docker Desktop's WSL2 kernel as WSL and spawns
# wslpath/powershell.exe (absent in the container) to open native paths.
# Fake wslpath echoes the target path; fake powershell.exe hands it to wish
# on the VNC display (:99, viewable through noVNC), so "Open configuration
# file" and host.openPath open the editor instead of failing with ENOENT.
RUN cat > /usr/local/bin/wslpath <<'SHIM'
#!/bin/sh
# Fake wslpath: dsh calls `wslpath -w <path>`; echo the path unchanged.
out=""
for arg in "$@"; do
  case "$arg" in
    -w|-u|-m|--*) ;;
    *) out="$arg" ;;
  esac
done
printf '%s\n' "${out:-/}"
exit 0
SHIM
RUN cat > /usr/local/bin/powershell.exe <<'SHIM'
#!/bin/sh
# Fake powershell.exe: dsh runs
#   powershell.exe -NoProfile -Command "Invoke-Item -LiteralPath '<path>'"
# Extract the path and open it with wish on the VNC desktop, then exit 0 so
# dsh reports the open as successful.
command_text=""
for arg in "$@"; do
  case "$arg" in
    -NoProfile|-Command) ;;
    *) command_text="$arg" ;;
  esac
done
path=""
if [ -n "$command_text" ]; then
  path=$(printf '%s' "$command_text" \
    | sed -n "s/.*-LiteralPath[[:space:]]*'\([^']*\)'[[:space:]]*$/\1/p" \
    | sed "s/''/'/g")
fi
if [ -z "$path" ] || [ ! -e "$path" ]; then exit 0; fi
DISPLAY="${DISPLAY:-:99}" /usr/bin/wish /usr/local/bin/dsh-editor.tcl "$path" >/dev/null 2>&1 &
exit 0
SHIM
RUN cat > /usr/local/bin/dsh-editor.tcl <<'SHIM'
#!/usr/bin/wish
# VNC desktop mini editor, opened by the fake powershell.exe above.
# File mode: edit and Save (Ctrl+S). Directory mode: double-click to descend.
set target [lindex $argv 0]
if {$target eq ""} { exit }

if {[file isdirectory $target]} {
  wm title . "Pick: $target"
  wm geometry . 680x520
  listbox .lb -width 90 -height 30 -yscrollcommand {.vs set}
  scrollbar .vs -command {.lb yview}
  pack .lb -side left -fill both -expand true
  pack .vs -side right -fill y
  foreach f [lsort [glob -nocomplain -directory $target *]] {
    .lb insert end [file tail $f]
  }
  bind .lb <Double-Button-1> {
    set sel [lindex [.lb curselection] 0]
    if {$sel ne ""} {
      exec wish [info script] [file join $target [.lb get $sel]] &
    }
  }
  return
}

wm title . "Edit: $target"
wm geometry . 900x640
frame .bar
button .bar.save -text "Save (Ctrl+S)" -command saveFile
button .bar.close -text "Close (Ctrl+W)" -command exit
label .bar.path -text $target -anchor w
pack .bar.save .bar.close -side left -padx 3 -pady 3
pack .bar.path -side left -fill x -expand true -padx 6
pack .bar -side top -fill x

text .txt -wrap word -undo true -yscrollcommand {.vs set} -font {TkFixedFont 11}
scrollbar .vs -command {.txt yview}
pack .txt -side left -fill both -expand true
pack .vs -side right -fill y

if {[catch {set fd [open $target r]; fconfigure $fd -encoding utf-8; set content [read $fd]; close $fd} err]} {
  tk_messageBox -message "Open failed: $err" -type ok -icon warning
  exit
}
.txt insert 1.0 $content
focus .txt

proc saveFile {} {
  global target
  if {[catch {
    set fd [open $target w]
    fconfigure $fd -encoding utf-8
    puts -nonewline $fd [.txt get 1.0 end-1c]
    close $fd
  } err]} {
    tk_messageBox -message "Save failed: $err" -type ok -icon error
    return
  }
  .bar.save configure -text "Saved ✓"
  after 1200 { .bar.save configure -text "Save (Ctrl+S)" }
}
bind .txt <Control-s> saveFile
bind .txt <Control-w> exit
bind . <Control-s> saveFile
bind . <Control-w> exit
SHIM
RUN chmod 0755 /usr/local/bin/wslpath /usr/local/bin/powershell.exe /usr/local/bin/dsh-editor.tcl

COPY --from=installer /usr/local/lib/node_modules/@deepseek-ai/dsh /usr/local/lib/node_modules/@deepseek-ai/dsh
COPY --from=installer /usr/local/lib/node_modules/pnpm /usr/local/lib/node_modules/pnpm
COPY scripts/chromium-docker /usr/local/bin/chromium-docker
COPY scripts/deepseek-harness-entrypoint /usr/local/bin/deepseek-harness-entrypoint
COPY plugins/dsh-browser-desktop /opt/deepseek-harness/plugins/dsh-browser-desktop

RUN chmod 0755 /usr/local/bin/chromium-docker \
        /usr/local/bin/deepseek-harness-entrypoint \
    && mkdir -p \
      /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@runzhliu \
      /opt/deepseek-harness/plugins/dsh-browser-desktop/node_modules/@deepseek-ai \
    && ln -s /opt/deepseek-harness/plugins/dsh-browser-desktop \
      /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@runzhliu/dsh-browser-desktop \
    && ln -s /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/schemastery \
      /opt/deepseek-harness/plugins/dsh-browser-desktop/node_modules/@deepseek-ai/schemastery \
    && ln -s ../lib/node_modules/@deepseek-ai/dsh/lib/bin.js /usr/local/bin/dsh \
    && ln -s ../lib/node_modules/pnpm/bin/pnpm.cjs /usr/local/bin/pnpm \
    && ln -s ../lib/node_modules/pnpm/bin/pnpx.cjs /usr/local/bin/pnpx \
    && ln -s chromium-docker /usr/local/bin/chrome \
    && ln -s chromium-docker /usr/local/bin/google-chrome \
    && ln -s chromium-docker /usr/local/bin/google-chrome-stable \
    && if [ ! -e /usr/share/novnc/index.html ]; then \
      ln -s vnc.html /usr/share/novnc/index.html; \
    fi \
    && test "$(dsh --version)" = "${DSH_VERSION}" \
    && test "$(pnpm --version)" = "${PNPM_VERSION}" \
    && chromium-docker --version

ENV DSH_HOME=/home/node/.dsh \
    DSH_TELEMETRY_DISABLED=1 \
    HOME=/workspace \
    NPM_CONFIG_CACHE=/home/node/.dsh/npm-cache \
    DISPLAY=:99 \
    XDG_RUNTIME_DIR=/tmp/runtime-node \
    CHROME_BIN=/usr/local/bin/chromium-docker \
    CHROME_PATH=/usr/local/bin/chromium-docker \
    CHROME_USER_DATA_DIR=/home/node/.dsh/chrome-profile \
    BROWSER=/usr/local/bin/chromium-docker \
    PUPPETEER_EXECUTABLE_PATH=/usr/local/bin/chromium-docker \
    XDG_CACHE_HOME=/tmp/.cache \
    XDG_CONFIG_HOME=/tmp/.config \
    XDG_DATA_HOME=/tmp/.local/share

COPY --chown=node:node web.cordis.patch.yml /opt/deepseek-harness/web.cordis.patch.yml

RUN mkdir -p "${DSH_HOME}" /workspace \
    && chown -R node:node "${DSH_HOME}" /workspace

USER node
WORKDIR /workspace

EXPOSE 3080 6080

# Keep source metadata after every filesystem-producing instruction so a new
# commit revision updates only image configuration instead of invalidating the
# large Debian/Chromium installation layers.
ARG IMAGE_VERSION=0.1.1-rc.2-r2
ARG IMAGE_REVISION=unknown
LABEL org.opencontainers.image.title="DeepSeek Harness Docker (Community)" \
      org.opencontainers.image.description="Community container image for the DeepSeek Harness CLI, Web UI, and browser-accessible Chromium desktop" \
      org.opencontainers.image.source="https://github.com/runzhliu/deepseek-harness-docker" \
      org.opencontainers.image.url="https://github.com/runzhliu/deepseek-harness-docker" \
      org.opencontainers.image.documentation="https://aik8s.run/ai-k8s/rag-agent/deepseek-harness-runtime-containerization/" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${IMAGE_VERSION}" \
      org.opencontainers.image.revision="${IMAGE_REVISION}" \
      io.github.runzhliu.deepseek-harness.base-image="${NODE_IMAGE}" \
      io.github.runzhliu.deepseek-harness.debian-codename="trixie" \
      io.github.runzhliu.deepseek-harness.upstream.repository="https://github.com/deepseek-ai/deepseek-harness" \
      io.github.runzhliu.deepseek-harness.upstream.release="https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v${DSH_VERSION}" \
      io.github.runzhliu.deepseek-harness.upstream.npm="@deepseek-ai/dsh@${DSH_VERSION}"

# The CLI mounts a config-only HMR watcher after profile boot. Scope Node's
# internal-module access flag to the dsh process instead of exporting it via
# NODE_OPTIONS to every child process the agent starts.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/deepseek-harness-entrypoint"]
CMD ["web", "--patch", "/opt/deepseek-harness/web.cordis.patch.yml", "--no-open"]
