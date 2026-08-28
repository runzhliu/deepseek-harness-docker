# Changelog

All notable changes to this project are documented here.

## Unreleased

- Change the default builder and runtime base from `node:24-bookworm-slim` to the official non-slim `node:24-trixie`, raising the runtime from glibc 2.36 to 2.41.
- Keep the buildpack-deps compiler toolchain available to coding-agent and native-plugin workflows, and add an explicit common CLI contract including `jq`, `less`, `ripgrep`, `rsync`, and `zip`.
- Extend the image smoke test to reject a non-Trixie base, an unexpected glibc version, or any missing required Agent command on both release architectures.
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
