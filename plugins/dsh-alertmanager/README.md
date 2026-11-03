# Alertmanager incident Source for Super Agent

MVP for the pinned `dsh-superagent-prototype` (`6337fc8`) on DSH `0.2.2-alpha.2` / Node 24. It registers an **Alertmanager** Source and records alert events in Superagent's native Threads. A separate deterministic incident workflow builds IM group plans, persists delivery state and supports an authenticated VMI bridge. It does not turn automated alerts into human instructions or enable Superagent's coding workers.

Default `observe` mode creates plans only. It makes no IM requests and needs no model. The prototype's GitHub/GitLab setup can remain unconfigured or read-only; incident intake does not depend on that setup. This package is an internal trial and is not published to npm.

## Install

In a Super Agent instance, place this package at an immutable path such as `/opt/dsh-alertmanager`, with its Zod and Schemastery peers resolvable from the DSH runtime. Register it with:

```sh
dsh plugin --profile web add --ignore-scripts link:/opt/dsh-alertmanager
```

Create `$DSH_HOME/alertmanager/policy.json` from [policy.example.json](policy.example.json). Replace service/cluster matches and **actual VMI account IDs**. Only exactly one matching route is accepted. Keep `mode: observe` initially. Do not put tokens in policy JSON.

Generate a dedicated random token in `$DSH_HOME/alertmanager/webhook-token` (32+ characters, permissions `0600`), and provision the same token to Alertmanager as a secret file. Never use the DSH launch token for this receiver.

The bundle binds the receiver to `127.0.0.1:9095`. For a Docker port mapping, explicitly override only this plugin's receiver host to the container interface or `0.0.0.0`; publish `127.0.0.1:9095:9095` for local testing. Remote Alertmanager needs an authenticated private network ingress to that receiver; the DSH management port stays protected. Production traffic should terminate TLS or use mTLS at the private ingress.

Merge [the Alertmanager receiver example](examples/alertmanager.yaml) into your monitoring configuration. `max_alerts: 0` avoids truncated groups. Batches over 500 alerts or 1 MiB, malformed input and truncated groups are rejected. Split oversized groups in Alertmanager.

Native Sources/Threads work without a custom client. For incident plans in **Superagent → Overview / Execution**, apply the optional panel integration before rebuilding the prototype:

```sh
node integration/install-panel.cjs /path/to/dsh-superagent-prototype
```

This adds `AlertmanagerPanel` to the two pages, preserves existing components, and can be run again. It does not modify DSH core. Incident jobs are shown separately from coding Tickets. Management routes use DSH's signed-cookie verification and same-origin headers.

## Lifecycle

- Group notifications are partitioned by configured instance, receiver, Alertmanager `groupKey`, and matched route.
- Fingerprint plus `startsAt` identifies one alert occurrence. Identical retries and moving firing `endsAt` values create no additional work.
- An incident stays firing until every known alert occurrence resolves. Resolved occurrences do not reopen on delayed firing notifications. A new occurrence after recovery starts a new incident.
- All input events and incident/group/action associations persist in SQLite. HTTP success follows the durable transaction; native Thread delivery retries after restart.
- `observe` plans remain plans after switching to live. Restart to apply policy changes; only new live incidents queue outbound work.
- The durable outbox uses stable operation IDs for group creation and messages, retries transient failures with backoff, and blocks changed routing/member policies. Authentication and contract failures stop retrying. A quickly recovered incident without a group skips obsolete creation.
- Disabling the Source stops intake and future dispatch. An already submitted remote request may still complete.

## VMI bridge contract

The local VMI reference lists `GroupCreate` and `GroupMemberAdd`, but does not establish a validated server authentication or request schema. This adapter deliberately does not guess their payload or extract personal client sessions. Connect a supported internal application/IM service using this contract:

| Endpoint | Request / response |
| --- | --- |
| `GET /v1/capabilities` | `{ "version":1, "durableIdempotency":true, "ensureGroup":true, "sendMessage":true }` |
| `POST /v1/groups/ensure` | `{operationId, externalKey, name, ownerId, memberIds}` → `{groupId}` |
| `POST /v1/groups/:groupId/messages` | `{operationId, text}` → `{sent:true}` |

Every request uses a dedicated `Authorization: Bearer …` secret. POSTs also carry `Idempotency-Key: operationId`. The **bridge must atomically persist operation results** and return the same group/result across retries, including a response lost after execution. Group membership must be validated by the bridge as well. Capability declarations alone do not prove this guarantee: verify it against the real bridge before use.

After verifying the real bridge, configure `mode: live` and a `bridge` object with `url` and an absolute `tokenFile`. HTTPS is required except for explicitly local HTTP endpoints. Redirects are refused. Credentials and remote response bodies are excluded from management errors.

The real VMI API was not called during implementation. Tests exercise the bridge protocol, including simulated acknowledgement loss, against mocks. Reading local VMI `chat.db` cannot create groups.

## Verify

```sh
node --test plugins/dsh-alertmanager/*.test.js
```

The tests cover duplicate/HA notifications, partial and out-of-order recovery, repeated incidents, routing limits, persistence, bearer authentication, replay after acknowledgement loss and bridge contract failures. Use the clearly marked [synthetic firing](examples/firing.json) and [recovery](examples/resolved.json) notifications for local UI checks. No real people are included in their plans.
