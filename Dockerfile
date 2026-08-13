# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS installer

ARG DSH_VERSION=0.1.0-rc.6

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
    && test "$(dsh --version)" = "${DSH_VERSION}" \
    && npm cache clean --force

FROM ${NODE_IMAGE}

ARG DSH_VERSION=0.1.0-rc.6

LABEL org.opencontainers.image.title="DeepSeek Harness Docker (Community)" \
      org.opencontainers.image.description="Community container image for the DeepSeek Harness CLI and Web UI" \
      org.opencontainers.image.source="https://github.com/runzhliu/deepseek-harness-docker" \
      org.opencontainers.image.url="https://github.com/runzhliu/deepseek-harness-docker" \
      org.opencontainers.image.documentation="https://aik8s.run/ai-k8s/rag-agent/deepseek-harness-runtime-containerization/" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${DSH_VERSION}"

# Keep the runtime useful to a coding agent without shipping a compiler
# toolchain. tini forwards signals and reaps child processes started by tools.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      ca-certificates \
      git \
      openssh-client \
      procps \
      python3 \
      ripgrep \
      tini \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /usr/local/lib/node_modules/@deepseek-ai

COPY --from=installer /usr/local/lib/node_modules/@deepseek-ai/dsh /usr/local/lib/node_modules/@deepseek-ai/dsh

RUN ln -s ../lib/node_modules/@deepseek-ai/dsh/lib/bin.js /usr/local/bin/dsh \
    && test "$(dsh --version)" = "${DSH_VERSION}"

ENV DSH_HOME=/home/node/.dsh \
    DSH_TELEMETRY_DISABLED=1 \
    HOME=/workspace \
    NODE_ENV=production

COPY --chown=node:node web.cordis.patch.yml /opt/deepseek-harness/web.cordis.patch.yml

RUN mkdir -p "${DSH_HOME}" /workspace \
    && chown -R node:node "${DSH_HOME}" /workspace

USER node
WORKDIR /workspace

EXPOSE 3080

# The CLI mounts a config-only HMR watcher after profile boot. Scope Node's
# internal-module access flag to the dsh process instead of exporting it via
# NODE_OPTIONS to every child process the agent starts.
ENTRYPOINT ["/usr/bin/tini", "--", "node", "--expose-internals", "/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js"]
CMD ["web", "--patch", "/opt/deepseek-harness/web.cordis.patch.yml"]
