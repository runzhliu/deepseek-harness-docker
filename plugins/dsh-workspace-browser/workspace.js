import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

export class WorkspaceError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'WorkspaceError'
    this.status = status
  }
}

function normalizeRequestedPath(input) {
  if (typeof input !== 'string') throw new WorkspaceError('path must be a string')
  if (input.includes('\0')) throw new WorkspaceError('path contains a null byte')

  const portable = input.replaceAll('\\', '/')
  if (portable.startsWith('/')) throw new WorkspaceError('path must be relative to the workspace')

  const segments = portable.split('/').filter((segment) => segment !== '' && segment !== '.')
  if (segments.some((segment) => segment === '..')) {
    throw new WorkspaceError('path cannot leave the workspace')
  }
  return segments.join('/')
}

function isInside(root, target) {
  return target === root || target.startsWith(`${root}${path.sep}`)
}

function filesystemError(error) {
  if (error instanceof WorkspaceError) return error
  if (error?.code === 'ENOENT') return new WorkspaceError('path does not exist', 404)
  if (error?.code === 'EEXIST') return new WorkspaceError('path already exists', 409)
  if (error?.code === 'ENOTEMPTY') return new WorkspaceError('directory is not empty', 409)
  if (error?.code === 'EACCES' || error?.code === 'EPERM') {
    return new WorkspaceError('workspace path is not writable', 403)
  }
  if (error?.code === 'EISDIR' || error?.code === 'ENOTDIR') {
    return new WorkspaceError('workspace path has the wrong type')
  }
  return error
}

function ensureContent(content, maxWriteBytes) {
  if (typeof content !== 'string') throw new WorkspaceError('content must be a string')
  const buffer = Buffer.from(content, 'utf8')
  if (buffer.length > maxWriteBytes) {
    throw new WorkspaceError(`content exceeds the ${maxWriteBytes} byte write limit`, 413)
  }
  return buffer
}

async function resolveExisting(root, requestedPath) {
  const relative = normalizeRequestedPath(requestedPath)
  const candidate = path.resolve(root, ...relative.split('/').filter(Boolean))
  if (!isInside(root, candidate)) throw new WorkspaceError('path cannot leave the workspace')

  let resolved
  try {
    resolved = await fs.realpath(candidate)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new WorkspaceError('path does not exist', 404)
    throw error
  }
  if (!isInside(root, resolved)) {
    throw new WorkspaceError('symbolic link leaves the workspace', 403)
  }
  return { relative, resolved }
}

async function resolveMutableExisting(root, requestedPath) {
  const relative = normalizeRequestedPath(requestedPath)
  if (relative.length === 0) throw new WorkspaceError('the workspace root cannot be changed', 403)

  const candidate = path.resolve(root, ...relative.split('/'))
  if (!isInside(root, candidate)) throw new WorkspaceError('path cannot leave the workspace')

  let entryStat
  try {
    entryStat = await fs.lstat(candidate)
  } catch (error) {
    throw filesystemError(error)
  }
  if (entryStat.isSymbolicLink()) {
    throw new WorkspaceError('symbolic links cannot be changed', 403)
  }

  const { resolved } = await resolveExisting(root, relative)
  return { relative, resolved, stat: entryStat }
}

async function resolveNewPath(root, requestedPath) {
  const relative = normalizeRequestedPath(requestedPath)
  if (relative.length === 0) throw new WorkspaceError('the workspace root cannot be changed', 403)

  const name = path.posix.basename(relative)
  const parentRelative = path.posix.dirname(relative) === '.' ? '' : path.posix.dirname(relative)
  const parent = await resolveExisting(root, parentRelative)
  const parentStat = await fs.stat(parent.resolved)
  if (!parentStat.isDirectory()) throw new WorkspaceError('parent path is not a directory')

  const target = path.join(parent.resolved, name)
  if (!isInside(root, target)) throw new WorkspaceError('path cannot leave the workspace')
  try {
    await fs.lstat(target)
    throw new WorkspaceError('path already exists', 409)
  } catch (error) {
    if (error instanceof WorkspaceError) throw error
    if (error?.code !== 'ENOENT') throw filesystemError(error)
  }
  return { relative, target }
}

export async function resolveWorkspaceRoot(root) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new WorkspaceError('workspace root must be a non-empty string')
  }
  try {
    return await fs.realpath(root)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new WorkspaceError('workspace root does not exist', 404)
    throw error
  }
}

export async function listWorkspace(root, requestedPath, maxEntries) {
  const { relative, resolved } = await resolveExisting(root, requestedPath)
  const stat = await fs.stat(resolved)
  if (!stat.isDirectory()) throw new WorkspaceError('path is not a directory')

  const dirents = await fs.readdir(resolved, { withFileTypes: true })
  if (dirents.length > maxEntries) {
    throw new WorkspaceError(`directory contains more than ${maxEntries} entries`, 413)
  }

  const entries = await Promise.all(dirents.map(async (entry) => {
    const absolute = path.join(resolved, entry.name)
    const entryStat = await fs.lstat(absolute)
    const entryPath = relative ? `${relative}/${entry.name}` : entry.name
    let type = 'other'
    if (entry.isDirectory()) type = 'directory'
    else if (entry.isFile()) type = 'file'
    else if (entry.isSymbolicLink()) type = 'symlink'

    return {
      name: entry.name,
      path: entryPath,
      type,
      size: entryStat.size,
      mtimeMs: entryStat.mtimeMs
    }
  }))

  entries.sort((left, right) => {
    if (left.type === 'directory' && right.type !== 'directory') return -1
    if (left.type !== 'directory' && right.type === 'directory') return 1
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
  })

  return {
    path: relative,
    name: relative ? path.posix.basename(relative) : path.basename(root),
    entries
  }
}

export async function readWorkspaceFile(root, requestedPath, maxPreviewBytes) {
  const { relative, resolved } = await resolveExisting(root, requestedPath)
  let handle
  try {
    handle = await fs.open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    if (error?.code === 'ELOOP') throw new WorkspaceError('symbolic link changed while opening the file', 409)
    throw error
  }
  let bytesRead = 0
  let buffer
  let stat
  try {
    stat = await handle.stat()
    if (!stat.isFile()) throw new WorkspaceError('path is not a regular file')
    const bytesToRead = Math.min(stat.size, maxPreviewBytes)
    buffer = Buffer.alloc(bytesToRead)
    const result = await handle.read(buffer, 0, bytesToRead, 0)
    bytesRead = result.bytesRead
  } finally {
    await handle.close()
  }
  buffer = buffer.subarray(0, bytesRead)

  const binary = buffer.includes(0)
  return {
    path: relative,
    name: path.posix.basename(relative),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    binary,
    truncated: stat.size > bytesRead,
    content: binary ? null : buffer.toString('utf8')
  }
}

export async function createWorkspaceEntry(root, requestedPath, type, content, maxWriteBytes) {
  if (type !== 'file' && type !== 'directory') {
    throw new WorkspaceError('type must be file or directory')
  }
  const { relative, target } = await resolveNewPath(root, requestedPath)

  try {
    if (type === 'directory') {
      await fs.mkdir(target)
      return { path: relative, name: path.posix.basename(relative), type }
    }

    const buffer = ensureContent(content ?? '', maxWriteBytes)
    const handle = await fs.open(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o644)
    try {
      await handle.writeFile(buffer)
    } finally {
      await handle.close()
    }
    const stat = await fs.stat(target)
    return {
      path: relative,
      name: path.posix.basename(relative),
      type,
      size: stat.size,
      mtimeMs: stat.mtimeMs
    }
  } catch (error) {
    throw filesystemError(error)
  }
}

export async function writeWorkspaceFile(root, requestedPath, content, maxWriteBytes, expectedMtimeMs) {
  const buffer = ensureContent(content, maxWriteBytes)
  const { relative, resolved } = await resolveMutableExisting(root, requestedPath)

  let handle
  try {
    handle = await fs.open(resolved, constants.O_RDWR | constants.O_NOFOLLOW)
    const before = await handle.stat()
    if (!before.isFile()) throw new WorkspaceError('path is not a regular file')
    if (expectedMtimeMs !== undefined) {
      if (typeof expectedMtimeMs !== 'number' || !Number.isFinite(expectedMtimeMs)) {
        throw new WorkspaceError('expectedMtimeMs must be a finite number')
      }
      if (before.mtimeMs !== expectedMtimeMs) {
        throw new WorkspaceError('file changed since it was opened', 409)
      }
    }
    await handle.writeFile(buffer)
    await handle.truncate(buffer.length)
    const after = await handle.stat()
    return {
      path: relative,
      name: path.posix.basename(relative),
      type: 'file',
      size: after.size,
      mtimeMs: after.mtimeMs
    }
  } catch (error) {
    throw filesystemError(error)
  } finally {
    await handle?.close()
  }
}

export async function renameWorkspaceEntry(root, requestedPath, destinationPath) {
  const source = await resolveMutableExisting(root, requestedPath)
  const destination = await resolveNewPath(root, destinationPath)
  if (source.stat.isDirectory() && isInside(source.resolved, destination.target)) {
    throw new WorkspaceError('a directory cannot be moved inside itself')
  }

  try {
    await fs.rename(source.resolved, destination.target)
  } catch (error) {
    throw filesystemError(error)
  }
  return {
    path: destination.relative,
    name: path.posix.basename(destination.relative),
    type: source.stat.isDirectory() ? 'directory' : source.stat.isFile() ? 'file' : 'other'
  }
}

export async function deleteWorkspaceEntry(root, requestedPath, recursive = false) {
  const entry = await resolveMutableExisting(root, requestedPath)
  try {
    if (entry.stat.isDirectory()) {
      if (recursive) await fs.rm(entry.resolved, { recursive: true })
      else await fs.rmdir(entry.resolved)
    } else {
      await fs.unlink(entry.resolved)
    }
  } catch (error) {
    throw filesystemError(error)
  }
  return { path: entry.relative, deleted: true }
}
