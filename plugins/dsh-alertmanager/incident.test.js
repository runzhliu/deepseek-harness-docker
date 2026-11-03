import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IncidentStore } from './store.js'
import { webhook, policy, InputError } from './domain.js'
import { VmiBridge, BridgeError } from './bridge.js'
import { receiver } from './http.js'

const alert = (extra = {}) => ({ fingerprint: 'abc', status: 'firing', startsAt: '2026-11-02T00:00:00Z', endsAt: '2026-11-02T01:00:00Z',
  labels: { service: 'api', cluster: 'test', severity: 'critical', alertname: 'ApiDown' }, annotations: { summary: 'API health check failed' }, ...extra })
const body = (...alerts) => ({ version: '4', receiver: 'ops', groupKey: '{}:{service="api"}', status: alerts.every(x => x.status === 'resolved') ? 'resolved' : 'firing', alerts })
const config = (extra = {}) => policy({ version: 1, instanceId: 'test', mode: 'observe', severities: ['critical'],
  routes: [{ id: 'api-test', match: { service: 'api', cluster: 'test' }, ownerId: 'owner', memberIds: ['owner', 'oncall'] }], ...extra })
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-alertmanager-test-')); let clock = Date.parse('2026-11-02T01:00:00Z')
  const file = join(dir, 'incidents.sqlite'); let store = new IncidentStore(file, () => new Date(clock).toISOString())
  t.after(() => { store?.close(); rmSync(dir, { recursive: true, force: true }) })
  return { dir, get store() { return store }, advance() { clock += 301000 }, reopen() { store.close(); store = new IncidentStore(file, () => new Date(clock).toISOString()); return store } }
}
test('repeated notifications with changing firing endsAt and key order create one incident and plan', t => {
  const h = setup(t), input = alert(); h.store.ingest(webhook(body(input)), config())
  const repeated = alert({ endsAt: '2026-11-02T04:00:00Z', labels: Object.fromEntries(Object.entries(input.labels).reverse()) })
  const result = h.store.ingest(webhook(body(repeated)), config())
  assert.equal(result.duplicate, 1); assert.equal(h.store.list().length, 1); assert.equal(h.store.list()[0].actions.length, 1)
  assert.equal(h.store.list()[0].actions[0].state, 'planned')
})
test('HA repeats and partial recovery preserve one group; a new startsAt opens a new episode', t => {
  const h = setup(t), a = alert(), b = alert({ fingerprint: 'def' })
  h.store.ingest(webhook(body(a, b)), config()); const id = h.store.list()[0].id
  h.store.ingest(webhook(body({ ...a, status: 'resolved' })), config()); assert.equal(h.store.incident(id).status, 'firing')
  h.store.ingest(webhook(body({ ...b, status: 'resolved' })), config()); assert.equal(h.store.incident(id).status, 'resolved')
  h.store.ingest(webhook(body(a, b)), config()); assert.equal(h.store.list().length, 1); assert.equal(h.store.incident(id).status, 'resolved')
  h.store.ingest(webhook(body(alert({ startsAt: '2026-11-02T05:00:00Z' }))), config()); assert.equal(h.store.list().length, 2)
  h.store.ingest(webhook(body({ ...a, status: 'resolved' })), config()); assert.equal(h.store.list().filter(x => x.status === 'firing').length, 1)
})
test('resolved-before-firing is terminal and never creates a chat action', t => {
  const h = setup(t); h.store.ingest(webhook(body(alert({ status: 'resolved' }))), config())
  h.store.ingest(webhook(body(alert())), config()); assert.equal(h.store.list()[0].status, 'resolved'); assert.deepEqual(h.store.list()[0].actions, [])
})
test('validation rejects truncation, malformed batches and excessive members before any commit', t => {
  const h = setup(t)
  assert.throws(() => webhook({ ...body(alert()), truncatedAlerts: 1 }), InputError)
  assert.throws(() => webhook(body(alert(), alert({ startsAt: 'not-a-date' }))), InputError)
  assert.throws(() => config({ routes: [{ id: 'api', match: { service: 'api' }, ownerId: 'x', memberIds: Array(31).fill('x') }] }), InputError)
  assert.equal(h.store.list().length, 0)
})
test('severity, service and ambiguous routes fail closed', t => {
  const h = setup(t)
  assert.equal(h.store.ingest(webhook(body(alert({ labels: { service: 'other', severity: 'critical' } }))), config()).filtered, 1)
  assert.equal(h.store.ingest(webhook(body(alert({ labels: { service: 'api', cluster: 'test', severity: 'warning' } }))), config()).filtered, 1)
  const c = config(), duplicate = { ...c.routes[0], id: 'other' }
  assert.equal(h.store.ingest(webhook(body(alert())), { ...c, routes: [...c.routes, duplicate] }).filtered, 1)
  assert.equal(h.store.list().length, 0)
})
test('observe mode and persisted plans never invoke the bridge, including after restart', async t => {
  const h = setup(t), adapter = { ensureGroup() { assert.fail('real group call') }, sendMessage() { assert.fail('real message call') } }
  h.store.ingest(webhook(body(alert())), config()); h.reopen()
  assert.equal(await h.store.executeNext(adapter, config()), false)
  assert.equal(h.store.list()[0].mode, 'observe'); assert.equal(h.store.pendingEvents().length, 1)
})
test('live delivery survives a lost message acknowledgement and restart without another group', async t => {
  const h = setup(t), rules = config({ mode: 'live', bridge: { url: 'http://127.0.0.1:1234', tokenFile: '/private/token' } })
  const groups = new Map(), messages = new Set(); let lost = true, creates = 0
  const adapter = { async ensureGroup(p) { if (!groups.has(p.operationId)) { groups.set(p.operationId, 'g1'); creates++ } return groups.get(p.operationId) },
    async sendMessage(m) { messages.add(m.operationId); if (lost) { lost = false; throw new BridgeError('bridge_unreachable') } } }
  h.store.ingest(webhook(body(alert())), rules); await h.store.executeNext(adapter, rules)
  assert.equal(h.store.list()[0].groupId, 'g1'); h.advance(); h.reopen(); await h.store.executeNext(adapter, rules)
  assert.equal(creates, 1); assert.equal(messages.size, 1); assert.equal(h.store.list()[0].actions[0].state, 'sent')
  h.store.ingest(webhook(body(alert({ status: 'resolved' }))), rules); await h.store.executeNext(adapter, rules)
  assert.equal(creates, 1); assert.equal(messages.size, 2); assert.equal(h.store.list()[0].actions[1].state, 'sent')
})
test('fast recovery before delivery skips creating an obsolete incident group', async t => {
  const h = setup(t), rules = config({ mode: 'live', bridge: { url: 'http://127.0.0.1:1234', tokenFile: '/private/token' } })
  h.store.ingest(webhook(body(alert())), rules); h.store.ingest(webhook(body(alert({ status: 'resolved' }))), rules)
  const adapter = { ensureGroup() { assert.fail('obsolete group') }, sendMessage() { assert.fail('obsolete message') } }
  await h.store.executeNext(adapter, rules); await h.store.executeNext(adapter, rules)
  assert(h.store.list()[0].actions.every(x => x.state === 'skipped'))
})
test('changed membership blocks queued execution rather than silently expanding access', async t => {
  const h = setup(t), rules = config({ mode: 'live', bridge: { url: 'http://127.0.0.1:1234', tokenFile: '/private/token' } })
  h.store.ingest(webhook(body(alert())), rules)
  await h.store.executeNext({ ensureGroup() { assert.fail('policy bypass') } }, { ...rules, routes: [{ ...rules.routes[0], memberIds: ['other'] }] })
  assert.equal(h.store.list()[0].actions[0].state, 'blocked')
})
test('webhook requires its own bearer credential and rejects browser requests, invalid content and truncation', async t => {
  const h = setup(t), token = 't'.repeat(40); let received = 0
  const server = receiver({ token, accept: input => { received++; return h.store.ingest(input, config()) } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const url = `http://127.0.0.1:${server.address().port}/webhooks/alertmanager`
  const send = (input, headers = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token, ...headers }, body: JSON.stringify(input) })
  assert.equal((await send(body(alert()), { authorization: 'Bearer invalid' })).status, 401)
  assert.equal((await send(body(alert()), { origin: 'http://evil.test' })).status, 403)
  assert.equal((await send(body(alert()), { 'content-type': 'text/plain' })).status, 415)
  assert.equal((await send({ ...body(alert()), truncatedAlerts: 3 })).status, 422)
  const r = await send(body(alert())); assert.equal(r.status, 200); assert.equal((await r.json()).accepted, 1)
  assert.equal(received, 1); assert.equal(h.store.list().length, 1)
})
test('bridge validates idempotency capabilities and never leaks response bodies into errors', async t => {
  const h = setup(t), file = join(h.dir, 'token'); writeFileSync(file, 'x'.repeat(40), { mode: 0o600 })
  const bad = new VmiBridge({ url: 'http://127.0.0.1:1', tokenFile: file }, async () => Response.json({ version: 1, durableIdempotency: false }))
  await assert.rejects(bad.ensureGroup({}), { code: 'bridge_idempotency_contract_required' })
  const denied = new VmiBridge({ url: 'http://127.0.0.1:1', tokenFile: file }, async () => new Response('SECRET-TOKEN', { status: 401 }))
  await assert.rejects(denied.verify(), error => error.code === 'bridge_http_401' && !error.retryable && !error.message.includes('SECRET'))
})

test('HTTP VMI adapter sends stable operation IDs and reuses a group across firing, lost acknowledgement and recovery', async t => {
  const h = setup(t), tokenFile = join(h.dir, 'bridge-token'); writeFileSync(tokenFile, 'b'.repeat(40), { mode: 0o600 })
  const { createServer } = await import('node:http'); const groups = new Map(), messages = new Map(); let loseOnce = true
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer ' + 'b'.repeat(40))
    const send = data => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)) }
    if (req.url === '/v1/capabilities') return send({ version: 1, durableIdempotency: true, ensureGroup: true, sendMessage: true })
    const chunks = []; for await (const c of req) chunks.push(c)
    const input = JSON.parse(Buffer.concat(chunks).toString()); assert.equal(req.headers['idempotency-key'], input.operationId)
    if (req.url === '/v1/groups/ensure') { groups.set(input.operationId, groups.get(input.operationId) ?? 'group-123'); return send({ groupId: groups.get(input.operationId) }) }
    assert.equal(req.url, '/v1/groups/group-123/messages'); messages.set(input.operationId, input.text)
    if (loseOnce) { loseOnce = false; res.destroy(); return }
    send({ sent: true })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r) }))
  const rules = config({ mode: 'live', bridge: { url: `http://127.0.0.1:${server.address().port}`, tokenFile } }), adapter = new VmiBridge(rules.bridge)
  h.store.ingest(webhook(body(alert())), rules); await h.store.executeNext(adapter, rules)
  assert.equal(h.store.list()[0].actions[0].state, 'pending'); h.reopen(); h.advance(); await h.store.executeNext(adapter, rules)
  assert.equal(h.store.list()[0].actions[0].state, 'sent'); assert.equal(groups.size, 1); assert.equal(messages.size, 1)
  h.store.ingest(webhook(body(alert({ status: 'resolved' }))), rules); await h.store.executeNext(adapter, rules)
  assert.equal(groups.size, 1); assert.equal(messages.size, 2)
})
