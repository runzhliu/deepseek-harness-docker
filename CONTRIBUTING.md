# Contributing

Thanks for improving this community container project.

Before opening a pull request:

1. Keep `@deepseek-ai/dsh` pinned through `DSH_VERSION`, and assign every container change a separate immutable `IMAGE_VERSION`; never reuse a published tag or switch to an unbounded `latest` install.
2. Preserve the local-only Web security posture. Do not add a public Ingress, LoadBalancer, unrestricted host port, Docker socket mount, `privileged`, or extra Linux capabilities.
3. Run `make verify`, `make build`, and `make smoke`; changes to the privacy variant must also pass `make ungoogled-build` and `make ungoogled-smoke`. `make verify` includes the cross-file version consistency check.
4. Test native dependencies on both `linux/amd64` and `linux/arm64` when changing Node, Debian, npm, or DSH versions.
5. Update both `README.md` and `README.en.md` when behavior or commands change.
6. Keep `plugins/dsh-browser-desktop` publishable on its own: run `make plugin-check`, avoid container-only imports, and document any new companion-service requirement.

The optional ungoogled-chromium build must keep its version and per-architecture SHA256 values pinned. Do not replace its contributor artifacts, advance their version, or add another architecture without re-running the full browser/noVNC smoke test and reviewing the upstream artifact source. The Debian Chromium image remains the default unless the project's supply-chain policy changes explicitly.

Run `make upstream-check` when reviewing an upstream DSH release. A GitHub tag alone is not sufficient for this project: the same version must exist as an installable `@deepseek-ai/dsh` npm artifact before changing `DSH_VERSION`.

The public image and plugin must not contain private provider endpoints, credentials, company-internal skills, or personal workspace mounts. Keep machine-specific Compose additions in the git-ignored `compose.local.yaml`.

Please report upstream Harness defects to the upstream channel described by its contribution guide. Issues specific to the Dockerfile, Compose file, Helm chart, or this documentation belong in this project.
