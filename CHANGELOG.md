# Changelog

All notable changes to this project are documented here.

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
