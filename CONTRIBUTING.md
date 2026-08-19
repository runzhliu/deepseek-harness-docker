# Contributing

Thanks for improving this community container project.

Before opening a pull request:

1. Keep `@deepseek-ai/dsh` pinned through `DSH_VERSION`; do not switch the image to an unbounded `latest` install.
2. Preserve the local-only Web security posture. Do not add a public Ingress, LoadBalancer, unrestricted host port, Docker socket mount, `privileged`, or extra Linux capabilities.
3. Run `make verify`, `make build`, and `make smoke`.
4. Test native dependencies on both `linux/amd64` and `linux/arm64` when changing Node, Debian, npm, or DSH versions.
5. Update both `README.md` and `README.en.md` when behavior or commands change.
6. Keep both packages under `plugins/` publishable on their own: run `make plugin-check`, avoid container-only imports, and document any companion-service requirement.
7. Keep workspace mutations same-origin, workspace-root constrained, size-bounded, and covered by traversal, symlink, deletion, and write-conflict tests. Any expansion of that boundary needs a separate security review.

The public image and plugin must not contain private provider endpoints, credentials, company-internal skills, or personal workspace mounts. Keep machine-specific Compose additions in the git-ignored `compose.local.yaml`.

Please report upstream Harness defects to the upstream channel described by its contribution guide. Issues specific to the Dockerfile, Compose file, Helm chart, or this documentation belong in this project.
