# Contributing

Thanks for improving this community container project.

Before opening a pull request:

1. Keep `@deepseek-ai/dsh` pinned through `DSH_VERSION`; do not switch the image to an unbounded `latest` install.
2. Preserve the local-only Web security posture. Do not add a public Ingress, LoadBalancer, unrestricted host port, Docker socket mount, `privileged`, or extra Linux capabilities.
3. Run `make verify`, `make build`, and `make smoke`.
4. Test native dependencies on both `linux/amd64` and `linux/arm64` when changing Node, Debian, npm, or DSH versions.
5. Update both `README.md` and `README.en.md` when behavior or commands change.

Please report upstream Harness defects to the upstream channel described by its contribution guide. Issues specific to the Dockerfile, Compose file, Helm chart, or this documentation belong in this project.
