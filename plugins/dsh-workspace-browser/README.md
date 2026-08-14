# `@runzhliu/dsh-workspace-browser`

A workspace file manager for the DeepSeek Harness Web UI. It adds a sidebar
action, directory navigation, breadcrumbs, metadata, bounded text previews,
text editing, and create, rename, and delete controls.

The Host half serves these endpoints:

- `GET /workspace-browser/list?path=<relative-path>` lists a directory.
- `GET /workspace-browser/file?path=<relative-path>` reads a bounded preview.
- `PUT /workspace-browser/file` updates a text file with an optional mtime precondition.
- `POST /workspace-browser/entry` creates a file or directory.
- `PATCH /workspace-browser/entry` renames or moves an entry.
- `DELETE /workspace-browser/entry` deletes an entry; recursive directory deletion must be explicit.

Every request is resolved under the configured workspace root. Parent traversal
and symbolic links escaping that root are rejected, and symbolic links cannot
be mutated. Mutation requests must be same-origin JSON. Text previews default
to 512 KiB, writes to 1 MiB, and directories to 2,000 entries.

## Install

After publication:

```bash
dsh plugin --profile web add @runzhliu/dsh-workspace-browser
```

For local package testing:

```bash
npm pack ./plugins/dsh-workspace-browser --pack-destination /tmp
dsh plugin --profile web add /tmp/runzhliu-dsh-workspace-browser-0.1.0.tgz
```

## Configuration

```yaml
- id: workspace-browser
  name: '@runzhliu/dsh-workspace-browser'
  config:
    root: '/workspace'
    maxEntries: 2000
    maxPreviewBytes: 524288
    maxWriteBytes: 1048576
```

## Security

This plugin deliberately permits writes inside its configured root. It does not
turn the Harness Web UI into a safe multi-tenant file service: users who can
access DSH can create, edit, rename, and recursively delete workspace content,
and may already have Shell or Agent tool access. Keep Harness behind a trusted
local, Tailnet, or authenticated gateway boundary, mount only the intended
workspace, and rely on version control or backups for recovery.

## License

MIT
