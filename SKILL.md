---
name: deepseek-harness-docker
description: Deploy, configure, verify, upgrade, and troubleshoot DeepSeek Harness with the community Docker, Docker Compose, and Helm runtime, including the built-in Chromium/noVNC browser and optional plugin market. Use when users ask to run DSH or DeepSeek Harness locally or on Kubernetes, mount a writable workspace, configure model credentials safely, enable the embedded browser, choose the market image, or diagnose container health and startup problems.
---

# DeepSeek Harness Docker

Use the public `runzhliu/deepseek-harness-docker` project as the source of truth. Treat it as a community containerization project around the official `@deepseek-ai/dsh` npm package, not as an official DeepSeek image.

## Preserve the security boundary

- Bind WebUI port `3080` and noVNC port `6080` to `127.0.0.1` only.
- Never create a public Ingress, LoadBalancer, NodePort, unrestricted `-p 3080:3080`, privileged container, or Docker socket mount.
- Pass provider keys only at runtime through the Harness settings page, environment variables, `.env`, or Kubernetes Secrets. Never write credentials into Dockerfiles, images, Compose files committed to Git, logs, or answers.
- Keep the named `dsh-home` volume unless the user explicitly asks to delete all Harness settings, credentials, sessions, and browser state.
- Mount only the workspace the user authorizes. Do not broaden a bind mount to a home directory or filesystem root.
- Treat the optional plugin market and every installed plugin as third-party code with access to the mounted workspace and persisted Harness profile.

## Locate the deployment files

Use the current checkout when it contains `compose.yaml` and `Dockerfile`. Otherwise clone the public repository:

```bash
git clone https://github.com/runzhliu/deepseek-harness-docker.git
cd deepseek-harness-docker
```

Read `README.md`, `SECURITY.md`, `compose.yaml`, and `.env.example` before changing defaults. Prefer the repository's pinned image and DSH versions; do not silently switch to `latest`.

## Choose the smallest suitable mode

Use default Compose for a local, single-user WebUI with the embedded Chromium desktop. Add `compose.market.yaml` only when the user explicitly wants the community plugin market. Use headless mode for one-shot automation and Helm only when the user requests Kubernetes.

## Start the default local runtime

1. Confirm Docker and Compose are available:

   ```bash
   docker version
   docker compose version
   ```

2. Resolve the requested workspace to an absolute path and confirm it is the intended writable directory.
3. Pull and start without rebuilding unless the user asks for a local source build:

   ```bash
   DSH_WORKSPACE=/absolute/path/to/project docker compose pull
   DSH_WORKSPACE=/absolute/path/to/project docker compose up -d --no-build
   docker compose ps
   ```

4. Wait for the `deepseek-harness` service to become healthy. Verify both surfaces:

   ```bash
   curl --fail http://127.0.0.1:3080/
   curl --fail http://127.0.0.1:6080/vnc.html
   docker compose logs --tail=120 deepseek-harness
   ```

5. Tell the user to open `http://127.0.0.1:3080`. Configure the model provider and key in Harness settings. Use the WebUI browser action for the embedded Chromium desktop; use `http://127.0.0.1:6080/vnc.html?autoconnect=1` only as a direct fallback.

## Enable the optional plugin market

Keep the default image unchanged and opt in through the overlay:

```bash
DSH_WORKSPACE=/absolute/path/to/project \
  docker compose -f compose.yaml -f compose.market.yaml pull
DSH_WORKSPACE=/absolute/path/to/project \
  docker compose -f compose.yaml -f compose.market.yaml up -d --no-build
docker compose -f compose.yaml -f compose.market.yaml ps
```

If the market reports a pnpm store version mismatch, stop the service and run the repository's explicit repair command from `README.md`. Do not delete the profile or named volume as a shortcut.

## Run a headless task

Use the pinned image and pass the provider key from the existing environment without printing it:

```bash
docker run --rm \
  --env DEEPSEEK_API_KEY \
  --mount type=volume,src=dsh-home,dst=/home/node/.dsh \
  --mount type=bind,src=/absolute/path/to/project,dst=/workspace \
  runzhliu/deepseek-harness:0.1.1-rc.2-r2 \
  --profile headless "summarize this repository"
```

Replace the provider environment variable and model configuration only when the selected provider requires it. Keep secrets out of command output and shell history where possible.

## Deploy with Helm

Use the included chart as a single-replica, stateful, private deployment:

```bash
helm lint --strict charts/deepseek-harness
helm upgrade --install deepseek-harness charts/deepseek-harness \
  --namespace deepseek-harness \
  --create-namespace
kubectl -n deepseek-harness rollout status statefulset/deepseek-harness
kubectl -n deepseek-harness port-forward service/deepseek-harness 3080:3080 6080:6080
```

Use an existing Secret for provider credentials and an existing PVC when a persistent writable workspace is required. Preserve the chart's private Service and NetworkPolicy defaults.

## Build or upgrade safely

- Run `make verify` before building changes.
- Run `make build` and `make smoke` for the default image.
- Run `make market-build` and `make market-smoke` for the optional market image.
- On version upgrades, update every pinned DSH/image reference together, inspect upstream release notes, and rerun the full verification. Do not publish an unverified tag or a drifting `latest` tag.
- Confirm both `linux/amd64` and `linux/arm64` when publishing multi-platform images.

## Diagnose failures

Start with non-destructive evidence:

```bash
docker compose config
docker compose ps
docker compose logs --tail=200 deepseek-harness
docker compose ps -q deepseek-harness
```

Pass the container ID reported by the last command to `docker inspect`; do not assume a fixed Compose project name.

Check these common boundaries:

- `3080` or `6080` already in use: choose different loopback host ports through `DSH_PORT` or `DSH_DESKTOP_PORT`.
- Workspace not writable: verify the exact bind source and its ownership instead of making broad host directories writable.
- Browser unhealthy: verify `/dev/shm`, the `6080` endpoint, and the `9222` Chromium debug endpoint from inside the container.
- Profile or plugin failure: inspect the persisted profile and plugin logs before repairing; preserve backups created by the market repair tool.
- Model request failure: verify provider URL, model name, and the presence of the expected environment variable without revealing its value.

Do not use `docker compose down --volumes`, remove named volumes, or overwrite profile files without explicit user approval and a clear explanation of the data loss.

## Report completion

State the selected image tag, workspace mount, exposed loopback URLs, container health, and verification performed. Distinguish a successful WebUI health check from a successful real model/tool call; perform the latter only when the user supplied a provider configuration and authorized the test.
