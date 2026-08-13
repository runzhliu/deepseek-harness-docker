# Security Policy

## Supported versions

Only the DSH version currently pinned by the default `DSH_VERSION` build argument is tested. This project tracks release candidates and does not promise backward compatibility.

## Deployment boundary

DeepSeek Harness Web currently has no application authentication or TLS and can initiate code execution through Agent tools. The supported deployment is a trusted, single-user instance accessed through host loopback or `kubectl port-forward`.

Public Ingress, LoadBalancer, NodePort, unrestricted `-p 3080:3080`, shared multi-user access, Docker socket mounts, and privileged containers are outside the supported security model.

## Reporting

Do not publish credentials, session content, private workspace paths, or exploitable deployment details in a public issue. Report vulnerabilities privately to the repository owner through GitHub Security Advisories. Report vulnerabilities in DeepSeek Harness itself through the upstream project's security channel.
