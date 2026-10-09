# Security Policy

## Supported versions

Only the DSH version currently pinned by the default `DSH_VERSION` build argument is tested. This project tracks release candidates and does not promise backward compatibility.

## Deployment boundary

DeepSeek Harness Web uses a process launch token, signed browser cookie, and Host/Origin checks, and can initiate code execution through Agent tools. This image's native endpoint uses HTTP by default; upstream supports opt-in native TLS from `0.2.1-alpha.2`, but this project's supported LAN configuration continues to terminate HTTPS at Caddy. The default supported deployment is a trusted, single-user instance accessed through host loopback or `kubectl port-forward`.

Trusted-LAN access is supported only through the opt-in `compose.lan.yaml` gateway. It binds Caddy to one explicit LAN address, terminates HTTPS, requires Basic Auth, passes the declared host to DSH's trusted-host check, and proxies versioned noVNC routes through that same protected origin. Ports 3080 and 6080 remain bound to host loopback. The bundled internal CA root must be installed on each authorized client, and a host firewall should restrict source networks.

Rootless Podman deployments must use `compose.podman.yaml` with `podman-compose 1.6.0` or newer. Its `keep-id` mapping preserves the image's non-root UID 1000 while making a selected host workspace writable, and its `:Z` suffix privately relabels that workspace on SELinux hosts. Never aim that bind mount at a shared home directory, filesystem root, or directory used by unrelated containers.

On Docker hosts where Landlock is genuinely unavailable, the optional `compose.bwrap.yaml` overlay selects the separately tagged bubblewrap image. It retains the non-root user, read-only root filesystem, dropped capabilities, and `no-new-privileges`, but relaxes the container seccomp and system-path masks so bubblewrap can create its inner namespaces. Prefer enabling Landlock when the kernel already provides it, and use this fallback only on trusted single-user Docker hosts with unprivileged user namespaces enabled. The fallback is not supported for rootless Podman or Kubernetes.

The gateway does not make Harness multi-tenant. All authenticated users share the same settings, credentials, sessions, workspace access, and Agent code-execution authority. Mutually untrusted users require separate instances and separate state/workspace volumes.

Public Ingress, LoadBalancer, NodePort, unrestricted `-p 3080:3080`, direct publication of noVNC, Internet forwarding of the LAN gateway, shared untrusted-user access, Docker socket mounts, and privileged containers are outside the supported security model.

The optional `market` image variant contains a third-party community catalog and installer. It is not part of the default image and does not imply review or endorsement of listed plugins. Keep package build scripts blocked until reviewed, restrict container egress where practical, and treat every installed plugin as code running with the Harness process's access to the workspace and persisted profile.

## Reporting

Do not publish credentials, session content, private workspace paths, or exploitable deployment details in a public issue. Report vulnerabilities privately to the repository owner through GitHub Security Advisories. Report vulnerabilities in DeepSeek Harness itself through the upstream project's security channel.
