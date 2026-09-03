# Changelog

All notable changes to this project are documented here.

## 0.1.4 - 2026-09-03

- Upgrade the official runtime to `@deepseek-ai/dsh@0.1.2-rc.1` and publish the immutable container revision as `0.1.2-rc.1-r1`.
- Adopt the first `0.1.2` release candidate, including the accumulated session UI, usage metrics, subagent messaging, persistent-shell, Web authentication, and runtime performance fixes published upstream.

## 0.1.3 - 2026-09-02

- Upgrade the official runtime to `@deepseek-ai/dsh@0.1.2-alpha.4` and publish the immutable container revision as `0.1.2-alpha.4-r1`.

## 0.1.2 - 2026-09-01

- Upgrade the official runtime to `@deepseek-ai/dsh@0.1.2-alpha.3` and publish the first immutable container revision as `0.1.2-alpha.3-r1`.
- Upgrade the optional community market to `dshmarket@1.38.1`, the first stable release tested compatible with the new DSH client module system.
- Update the embedded browser plugin to `0.1.2` and migrate its Web dependency from the removed client runtime package to the new client module system.
- Adapt Compose, Helm, and smoke-test health checks to DSH's launch-token authentication: anonymous root requests must return `401`, while the token exchange must produce a working signed browser session.
- Refresh an existing automated upgrade issue when upstream advances again, distinguish npm dist-tags in the report, and close the issue after the pinned version catches up.
- Separate the immutable container revision (`0.1.1-rc.2-r2`) from the packaged upstream DSH version (`0.1.1-rc.2`) so runtime changes cannot silently reuse an existing image tag.
- Stop injecting `NODE_ENV=production` into Agent shells and user projects, and cover the boundary in the image smoke test.
- Default Compose workspaces to a named volume instead of mounting this repository, while keeping explicit host-project bind mounts supported.
- Expose the browser desktop through the Helm Service, provide a 1 GiB `/dev/shm`, and align Kubernetes resource requests and readiness checks with the actual desktop runtime.
- Add a cross-file version consistency check and cover the optional market image on both native release architectures in CI.
- Change the default builder and runtime base from `node:24-bookworm-slim` to the official non-slim `node:24-trixie`, raising the runtime from glibc 2.36 to 2.41.
- Keep the buildpack-deps compiler toolchain available to coding-agent and native-plugin workflows, and add an explicit common CLI contract including `jq`, `less`, `ripgrep`, `rsync`, and `zip`.
- Extend the image smoke test to reject a non-Trixie base, an unexpected glibc version, or any missing required Agent command on both release architectures.
- Link the pinned DSH version to its exact upstream GitHub Release and npm artifact in the README and image metadata.
- Add a daily GitHub Release/npm watcher that opens an upgrade issue only after the newest upstream DSH version is installable from npm.
- Mirror the published Docker Hub multi-platform manifests to `ghcr.io/runzhliu/deepseek-harness`, with digest verification and no rebuild or `latest` tag.
- Add an explicitly optional `Dockerfile.market` derived image and Compose overlay that pin the third-party `dshmarket@1.21.0` package.
- Keep the default Docker target, Compose stack, Helm chart, and DSH Web patch free of the community market.
- Test the default official-DSH integration separately from the optional market variant, including hardened runtime checks and disabled market-owned restarts.
- Keep the optional variant's pnpm store in `dsh-home` and provide an explicit, backed-up migration for profiles created by a different pnpm major.
- Repair only a non-writable regular `cordis.patch.yml` with a byte-equivalent, current-user-owned copy so plugin toggles work after reusing volumes created under another UID.

## 0.1.1 - 2026-08-24

- Upgrade the official runtime to `@deepseek-ai/dsh@0.1.1-rc.2`.
- Disable the upstream automatic browser handoff so the container-managed Chromium desktop remains the single browser lifecycle owner.
- Declare browser desktop plugin compatibility with both the original `0.1.0-rc.6` baseline and the new `0.1.1-rc.2` release candidate.
- Keep the Node.js 24 base, pnpm runtime, hardened Compose deployment, and dual-architecture image layout unchanged after native ARM64 validation.

## 0.1.0 - 2026-08-13

- Package the official `@deepseek-ai/dsh@0.1.0-rc.6` npm distribution.
- Add a Node.js 24 multi-stage, non-root Docker image for `linux/amd64` and `linux/arm64`.
- Add a loopback-only, read-only-root Docker Compose deployment with persistent Harness state.
- Add a single-replica StatefulSet Helm chart with PVC retention, Secret injection, hardened Pod security, and deny-ingress NetworkPolicy.
- Set the interactive home to writable `/workspace`, fixing Web directory creation failures under `/home/node`.
- Add bilingual documentation, smoke tests, CI, security policy, and a sanitized screenshot from the published image.
