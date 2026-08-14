import z from '@deepseek-ai/schemastery'

export const name = 'browser-desktop'
export const inject = ['tools', 'systemPrompt', 'webServer']

const defaultDesktopPath = '/vnc.html?autoconnect=1&resize=scale&view_only=0&reconnect=1'

export const Config = z.object({
  cdpBaseUrl: z.string().min(1).default('http://127.0.0.1:9222'),
  desktopPort: z.number().step(1).min(1).max(65535).default(6080),
  desktopPath: z.string().min(1).default(defaultDesktopPath),
  pollIntervalMs: z.number().step(1).min(250).max(10000).default(750)
})

function normalizeBaseUrl(input) {
  const parsed = new URL(input)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('cdpBaseUrl must use http:// or https://')
  }
  return parsed.toString().replace(/\/$/, '')
}

function normalizeDesktopPath(input) {
  const parsed = new URL(input, 'http://browser-desktop.invalid')
  if (parsed.origin !== 'http://browser-desktop.invalid') {
    throw new Error('desktopPath must be a same-origin absolute path')
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

function normalizeUrl(input) {
  const value = input.trim()
  if (value.length === 0) throw new Error('url must be a non-empty string')

  const parsed = new URL(value.includes('://') ? value : `https://${value}`)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('only http:// and https:// URLs can be opened')
  }
  return parsed.toString()
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body)
  })
  res.end(body)
}

async function readJson(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 16384) throw new Error('request body is too large')
  }
  if (body.length === 0) throw new Error('request body is required')
  return JSON.parse(body)
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

export function apply(ctx, config = {}) {
  const cdpBase = normalizeBaseUrl(config.cdpBaseUrl ?? 'http://127.0.0.1:9222')
  const desktop = {
    port: config.desktopPort ?? 6080,
    path: normalizeDesktopPath(config.desktopPath ?? defaultDesktopPath)
  }
  const pollIntervalMs = config.pollIntervalMs ?? 750

  let state = {
    revision: 0,
    url: null,
    openedAt: 0
  }

  async function cdpFetch(path, init, signal) {
    let lastError
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const response = await fetch(`${cdpBase}${path}`, { ...init, signal })
        if (!response.ok) throw new Error(`Chromium DevTools returned HTTP ${response.status}`)
        return response
      } catch (error) {
        lastError = error
        if (signal?.aborted) throw error
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    }
    throw lastError
  }

  async function openUrl(input, signal) {
    const url = normalizeUrl(input)
    const response = await cdpFetch(`/json/new?${encodeURIComponent(url)}`, { method: 'PUT' }, signal)
    const target = await response.json()
    await cdpFetch(`/json/activate/${encodeURIComponent(target.id)}`, {}, signal)
    state = {
      revision: state.revision + 1,
      url,
      openedAt: Date.now()
    }
    return { url, status: 'opened' }
  }

  ctx.systemPrompt.section({
    name: 'tool:browser_open',
    order: 115,
    text: 'When the user asks to open, show, or view a URL in the embedded browser, call browser_open. It opens the real container Chromium and automatically displays it inside the Harness Web UI. Do not investigate or reinstall browser, VNC, noVNC, or websockify.'
  })

  ctx.tools.register({
    name: 'browser_open',
    description: 'Open an HTTP or HTTPS URL in the interactive browser embedded in the Harness Web UI. The browser panel appears automatically for the user.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: {
          type: 'string',
          description: 'The URL to open. A missing scheme defaults to https://.'
        }
      },
      required: ['url']
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string' },
          status: { type: 'string' }
        },
        required: ['url', 'status']
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Opened ${value.url} in the embedded browser.`
      }]
    },
    async execute(args, exec) {
      if (typeof args?.url !== 'string') throw new Error('url must be a string')
      return openUrl(args.url, exec.signal)
    }
  })

  ctx.effect(() => {
    const disposeState = ctx.webServer.register({
      kind: 'exact',
      path: '/browser-desktop/state',
      handler(req, res) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405)
          res.end()
          return
        }
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'cache-control': 'no-store' })
          res.end()
          return
        }
        sendJson(res, 200, { ...state, desktop, pollIntervalMs })
      }
    })

    const disposeOpen = ctx.webServer.register({
      kind: 'exact',
      path: '/browser-desktop/open',
      async handler(req, res) {
        if (req.method !== 'POST') {
          res.writeHead(405)
          res.end()
          return
        }
        if (!isSameOrigin(req)) {
          sendJson(res, 403, { error: 'cross-origin requests are not allowed' })
          return
        }
        try {
          const input = await readJson(req)
          if (typeof input?.url !== 'string') throw new Error('url must be a string')
          sendJson(res, 200, await openUrl(input.url))
        } catch (error) {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : 'unable to open URL'
          })
        }
      }
    })

    return () => {
      disposeOpen()
      disposeState()
    }
  }, 'browser-desktop: HTTP routes')
}
