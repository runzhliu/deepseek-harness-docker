# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS installer

ARG DSH_VERSION=0.1.0-rc.6
ARG PNPM_VERSION=10.15.1

# node-pty publishes prebuilds for only some Linux architectures. Keep a
# compiler in this stage so linux/arm64 can fall back to node-gyp without
# carrying build-essential into the runtime image.
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

ARG DSH_VERSION=0.1.0-rc.6
ARG PNPM_VERSION=10.15.1

LABEL org.opencontainers.image.title="DeepSeek Harness Docker (Community)" \
      org.opencontainers.image.description="Community container image for the DeepSeek Harness CLI, Web UI, and browser-accessible Chromium desktop" \
      org.opencontainers.image.source="https://github.com/runzhliu/deepseek-harness-docker" \
      org.opencontainers.image.url="https://github.com/runzhliu/deepseek-harness-docker" \
      org.opencontainers.image.documentation="https://aik8s.run/ai-k8s/rag-agent/deepseek-harness-runtime-containerization/" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${DSH_VERSION}"

# Keep the runtime useful to a coding agent without shipping a compiler
# toolchain. Chromium is installed from Debian so both linux/amd64 and
# linux/arm64 stay native; the reference linuxserver/chrome base is amd64-only.
# Noto CJK keeps Chinese pages and screenshots readable.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      ca-certificates \
      chromium \
      fonts-liberation \
      fonts-noto-cjk \
      git \
      novnc \
      openbox \
      openssh-client \
      procps \
      python3 \
      ripgrep \
      tini \
      websockify \
      x11-utils \
      x11vnc \
      xterm \
      xvfb \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /usr/local/lib/node_modules/@deepseek-ai

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
    NODE_ENV=production \
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

# The CLI mounts a config-only HMR watcher after profile boot. Scope Node's
# internal-module access flag to the dsh process instead of exporting it via
# NODE_OPTIONS to every child process the agent starts.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/deepseek-harness-entrypoint"]
CMD ["web", "--patch", "/opt/deepseek-harness/web.cordis.patch.yml"]
