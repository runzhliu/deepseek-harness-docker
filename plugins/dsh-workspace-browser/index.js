import z from '@deepseek-ai/schemastery'
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

export const name = 'workspace-browser'
export const inject = ['webServer']

export const Config = z.object({
  root: z.string().min(1).default('/workspace'),
  maxEntries: z.number().step(1).min(1).max(10000).default(2000),
  maxPreviewBytes: z.number().step(1).min(1024).max(2097152).default(524288),
  maxWriteBytes: z.number().step(1).min(1024).max(8388608).default(1048576)
})

function sendJson(res, status, value, method = 'GET') {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body)
  })
  res.end(method === 'HEAD' ? undefined : body)
}

function requestPath(req) {
  const url = new URL(req.url, 'http://workspace-browser.invalid')
  return url.searchParams.get('path') ?? ''
}

async function readJson(req, limit) {
  const contentType = req.headers['content-type'] ?? ''
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new WorkspaceError('content-type must be application/json', 415)
  }

  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new WorkspaceError('request body is too large', 413)
    chunks.push(chunk)
  }
  if (size === 0) throw new WorkspaceError('request body is required')
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new WorkspaceError('request body must be a JSON object')
    }
    return value
  } catch (error) {
    if (error instanceof WorkspaceError) throw error
    throw new WorkspaceError('request body is not valid JSON')
  }
}

function isSameOrigin(req) {
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

function requireMutationRequest(req) {
  if (!isSameOrigin(req)) {
    throw new WorkspaceError('cross-origin requests are not allowed', 403)
  }
}

function handleError(res, error, method) {
  const status = error instanceof WorkspaceError ? error.status : 500
  const message = error instanceof WorkspaceError
    ? error.message
    : 'unable to update the workspace'
  sendJson(res, status, { error: message }, method)
}

export function apply(ctx, config = {}) {
  let rootPromise
  const getRoot = () => {
    rootPromise ??= resolveWorkspaceRoot(config.root ?? '/workspace')
    return rootPromise
  }
  const maxEntries = config.maxEntries ?? 2000
  const maxPreviewBytes = config.maxPreviewBytes ?? 524288
  const maxWriteBytes = config.maxWriteBytes ?? 1048576
  const maxRequestBytes = maxWriteBytes * 6 + 16384

  ctx.effect(() => {
    const disposeList = ctx.webServer.register({
      kind: 'exact',
      path: '/workspace-browser/list',
      async handler(req, res) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { allow: 'GET, HEAD' })
          res.end()
          return
        }
        try {
          const root = await getRoot()
          const listing = await listWorkspace(root, requestPath(req), maxEntries)
          sendJson(res, 200, listing, req.method)
        } catch (error) {
          handleError(res, error, req.method)
        }
      }
    })

    const disposeFile = ctx.webServer.register({
      kind: 'exact',
      path: '/workspace-browser/file',
      async handler(req, res) {
        if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'PUT') {
          res.writeHead(405, { allow: 'GET, HEAD, PUT' })
          res.end()
          return
        }
        try {
          const root = await getRoot()
          if (req.method === 'PUT') {
            requireMutationRequest(req)
            const input = await readJson(req, maxRequestBytes)
            const result = await writeWorkspaceFile(
              root,
              input.path,
              input.content,
              maxWriteBytes,
              input.expectedMtimeMs
            )
            sendJson(res, 200, result, req.method)
          } else {
            const preview = await readWorkspaceFile(root, requestPath(req), maxPreviewBytes)
            sendJson(res, 200, preview, req.method)
          }
        } catch (error) {
          handleError(res, error, req.method)
        }
      }
    })

    const disposeEntry = ctx.webServer.register({
      kind: 'exact',
      path: '/workspace-browser/entry',
      async handler(req, res) {
        if (req.method !== 'POST' && req.method !== 'PATCH' && req.method !== 'DELETE') {
          res.writeHead(405, { allow: 'POST, PATCH, DELETE' })
          res.end()
          return
        }
        try {
          requireMutationRequest(req)
          const root = await getRoot()
          const input = await readJson(req, maxRequestBytes)
          let result
          let status = 200
          if (req.method === 'POST') {
            result = await createWorkspaceEntry(
              root,
              input.path,
              input.type,
              input.content,
              maxWriteBytes
            )
            status = 201
          } else if (req.method === 'PATCH') {
            result = await renameWorkspaceEntry(root, input.path, input.destinationPath)
          } else {
            if (input.recursive !== undefined && typeof input.recursive !== 'boolean') {
              throw new WorkspaceError('recursive must be a boolean')
            }
            result = await deleteWorkspaceEntry(root, input.path, input.recursive ?? false)
          }
          sendJson(res, status, result, req.method)
        } catch (error) {
          handleError(res, error, req.method)
        }
      }
    })

    return () => {
      disposeEntry()
      disposeFile()
      disposeList()
    }
  }, 'workspace-browser: workspace CRUD HTTP routes')
}
