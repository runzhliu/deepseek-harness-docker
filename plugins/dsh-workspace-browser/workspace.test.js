import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  WorkspaceError,
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  listWorkspace,
  readWorkspaceFile,
  renameWorkspaceEntry,
  writeWorkspaceFile,
  resolveWorkspaceRoot
} from './workspace.js'

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-workspace-browser-'))
  const root = path.join(base, 'workspace')
  const outside = path.join(base, 'outside')
  await fs.mkdir(path.join(root, 'src'), { recursive: true })
  await fs.mkdir(outside)
  await fs.writeFile(path.join(root, 'README.md'), 'hello workspace\n')
  await fs.writeFile(path.join(root, 'src', 'app.js'), 'console.log("ok")\n')
  await fs.writeFile(path.join(outside, 'secret.txt'), 'outside\n')
  await fs.symlink(path.join(outside, 'secret.txt'), path.join(root, 'escape'))
  t.after(() => fs.rm(base, { recursive: true, force: true }))
  return resolveWorkspaceRoot(root)
}

test('lists directories before files', async (t) => {
  const root = await fixture(t)
  const listing = await listWorkspace(root, '', 20)
  assert.deepEqual(listing.entries.map(({ name, type }) => ({ name, type })), [
    { name: 'src', type: 'directory' },
    { name: 'escape', type: 'symlink' },
    { name: 'README.md', type: 'file' }
  ])
})

test('reads a bounded UTF-8 preview', async (t) => {
  const root = await fixture(t)
  const preview = await readWorkspaceFile(root, 'src/app.js', 8)
  assert.equal(preview.content, 'console.')
  assert.equal(preview.truncated, true)
  assert.equal(preview.binary, false)
})

test('rejects parent traversal and escaping symlinks', async (t) => {
  const root = await fixture(t)
  await assert.rejects(
    () => readWorkspaceFile(root, '../outside/secret.txt', 100),
    (error) => error instanceof WorkspaceError && error.status === 400
  )
  await assert.rejects(
    () => readWorkspaceFile(root, 'escape', 100),
    (error) => error instanceof WorkspaceError && error.status === 403
  )
})

test('creates files and directories without overwriting entries', async (t) => {
  const root = await fixture(t)
  const directory = await createWorkspaceEntry(root, 'notes', 'directory', undefined, 100)
  const file = await createWorkspaceEntry(root, 'notes/todo.txt', 'file', 'first\n', 100)

  assert.equal(directory.type, 'directory')
  assert.equal(file.path, 'notes/todo.txt')
  assert.equal(await fs.readFile(path.join(root, 'notes', 'todo.txt'), 'utf8'), 'first\n')
  await assert.rejects(
    () => createWorkspaceEntry(root, 'notes/todo.txt', 'file', '', 100),
    (error) => error instanceof WorkspaceError && error.status === 409
  )
})

test('updates and truncates text files with optimistic conflict detection', async (t) => {
  const root = await fixture(t)
  const preview = await readWorkspaceFile(root, 'README.md', 100)
  const updated = await writeWorkspaceFile(root, 'README.md', 'short\n', 100, preview.mtimeMs)

  assert.equal(updated.size, 6)
  assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), 'short\n')

  await fs.utimes(path.join(root, 'README.md'), new Date(), new Date(updated.mtimeMs + 5000))
  await assert.rejects(
    () => writeWorkspaceFile(root, 'README.md', 'stale', 100, updated.mtimeMs),
    (error) => error instanceof WorkspaceError && error.status === 409
  )
})

test('renames files and directories while preventing overwrite and self moves', async (t) => {
  const root = await fixture(t)
  const moved = await renameWorkspaceEntry(root, 'README.md', 'src/README.md')
  assert.equal(moved.path, 'src/README.md')
  assert.equal(await fs.readFile(path.join(root, 'src', 'README.md'), 'utf8'), 'hello workspace\n')

  await assert.rejects(
    () => renameWorkspaceEntry(root, 'src/README.md', 'src/app.js'),
    (error) => error instanceof WorkspaceError && error.status === 409
  )
  await assert.rejects(
    () => renameWorkspaceEntry(root, 'src', 'src/nested/src'),
    (error) => error instanceof WorkspaceError && error.status === 404
  )

  await fs.mkdir(path.join(root, 'src', 'nested'))
  await assert.rejects(
    () => renameWorkspaceEntry(root, 'src', 'src/nested/src'),
    (error) => error instanceof WorkspaceError && error.status === 400
  )
})

test('deletes files, empty directories, and recursively confirmed trees', async (t) => {
  const root = await fixture(t)
  await createWorkspaceEntry(root, 'empty', 'directory', undefined, 100)
  await deleteWorkspaceEntry(root, 'empty')
  await assert.rejects(() => fs.stat(path.join(root, 'empty')), { code: 'ENOENT' })

  await assert.rejects(
    () => deleteWorkspaceEntry(root, 'src'),
    (error) => error instanceof WorkspaceError && error.status === 409
  )
  await deleteWorkspaceEntry(root, 'src', true)
  await deleteWorkspaceEntry(root, 'README.md')
  await assert.rejects(() => fs.stat(path.join(root, 'src')), { code: 'ENOENT' })
  await assert.rejects(() => fs.stat(path.join(root, 'README.md')), { code: 'ENOENT' })
})

test('protects root, symbolic links, traversal, and write limits from mutations', async (t) => {
  const root = await fixture(t)
  const cases = [
    () => deleteWorkspaceEntry(root, '', true),
    () => writeWorkspaceFile(root, 'escape', 'changed', 100),
    () => renameWorkspaceEntry(root, 'escape', 'renamed'),
    () => createWorkspaceEntry(root, '../outside/new.txt', 'file', '', 100),
    () => writeWorkspaceFile(root, 'README.md', 'too large', 3)
  ]
  for (const operation of cases) {
    await assert.rejects(operation, (error) => error instanceof WorkspaceError && error.status >= 400)
  }
  assert.equal(await fs.readFile(path.join(path.dirname(root), 'outside', 'secret.txt'), 'utf8'), 'outside\n')
})
