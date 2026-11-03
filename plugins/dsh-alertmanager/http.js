import { timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { webhook, InputError } from './domain.js'

export function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value))
}
export async function readJson(req) {
  let size = 0; const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > 1024 * 1024) throw new InputError('Webhook exceeds 1 MiB', 413)
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new InputError('Invalid JSON') }
}
export function authenticated(req, token) {
  const actual = Buffer.from(req.headers.authorization ?? ''), expected = Buffer.from('Bearer ' + token)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
export function receiver({ token, accept, enabled = () => true }) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 4096 || /\s/.test(token)) throw new Error('Webhook requires a dedicated 32+ character token file')
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || req.url !== '/webhooks/alertmanager') { json(res, 404, { error: 'Not found' }); return }
      if (!authenticated(req, token)) { json(res, 401, { error: 'Unauthorized' }); return }
      if (req.headers.origin !== undefined) { json(res, 403, { error: 'Browser requests are not accepted' }); return }
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) { json(res, 415, { error: 'application/json required' }); return }
      if (!enabled()) { json(res, 503, { error: 'Alertmanager Source is disabled' }); return }
      const payload = webhook(await readJson(req)), result = await accept(payload)
      // Return only after the entire validated batch committed to durable storage.
      json(res, 200, result)
    } catch (error) { json(res, error instanceof InputError ? error.status : 503, { error: error instanceof InputError ? error.message : 'Intake unavailable; retry later' }) }
  })
  server.headersTimeout = 10000; server.requestTimeout = 15000; server.maxConnections = 100
  return server
}
