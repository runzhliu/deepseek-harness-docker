import schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { readFileSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import { IncidentStore } from './store.js'
import { policy } from './domain.js'
import { VmiBridge } from './bridge.js'
import { receiver, json } from './http.js'

export const name = 'dsh-alertmanager'
export const inject = ['orchestrator', 'webServer', 'connection', 'tools']
const home = process.env.DSH_HOME || join(homedir(), '.dsh')
export const Config = schema.object({ stateDir: schema.string().default(join(home, 'state/alertmanager')), policyFile: schema.string().default(join(home, 'alertmanager/policy.json')), tokenFile: schema.string().default(join(home, 'alertmanager/webhook-token')),
  host: schema.string().default('127.0.0.1'), port: schema.number().step(1).min(1).max(65535).default(9095) })
export function resolveConfig(config = {}) {
  const value = { stateDir: join(home, 'state/alertmanager'), policyFile: join(home, 'alertmanager/policy.json'), tokenFile: join(home, 'alertmanager/webhook-token'), host: '127.0.0.1', port: 9095, ...config }
  for (const key of ['stateDir', 'policyFile', 'tokenFile']) if (!isAbsolute(value[key] ?? '')) throw new Error(key + ' must be an absolute path')
  return value
}
export async function apply(ctx, config) {
  config = resolveConfig(config)
  const rules = policy(JSON.parse(readFileSync(config.policyFile, 'utf8')))
  const store = new IncidentStore(join(config.stateDir, 'incidents.sqlite'))
  let source, enabled = false, stopped = false, busy, timer, server
  const descriptor = {
    kind: 'alertmanager', title: { zh: 'Alertmanager', en: 'Alertmanager' },
    description: { zh: '接收告警和恢复事件；独立的事故协同流程，不启动编码 Worker。', en: 'Receives alerts and resolutions through a separate incident workflow, without coding workers.' },
    schema: z.object({}).strict(), fields: [
      { key: 'mode', type: 'fact', label: { zh: '执行模式', en: 'Execution mode' } },
      { key: 'routes', type: 'fact', label: { zh: '已配置路由', en: 'Configured routes' } },
    ],
    facts: () => ({ mode: rules.mode === 'observe' ? { zh: '仅生成计划，不发送消息', en: 'Plan only; no messages' } : { zh: '白名单自动执行', en: 'Allowlisted live execution' }, routes: rules.routes.map(r => r.id).join(', ') || '—' }),
    health: ['alertmanager'],
    // Context-only intake: automated alerts never impersonate human instructions.
    scope: ({ meta }) => ({ listened: !!store.incident(meta.incidentId), observed: false }),
    threadContext: {
      messageId: trigger => trigger.id,
      read: async (_commands, trigger) => ({ messages: store.events(trigger.meta.incidentId).map(e => ({ id: e.id, from: 'alertmanager', bot: true, at: e.at, text: JSON.stringify(e.alert) })), body: {} }),
    },
  }
  const disposeKind = ctx.orchestrator.sources.register(descriptor)
  try {
    source = ctx.orchestrator.context(descriptor)
    await source.ready
    const adapter = rules.bridge ? new VmiBridge(rules.bridge) : undefined
    const refresh = () => { enabled = source.config('alertmanager') !== undefined; return enabled }
    const forward = async () => {
      if (!refresh()) { source.report('alertmanager', { state: 'paused', detail: 'Alertmanager Source is off' }); return }
      for (const event of store.pendingEvents()) {
        const incident = store.incident(event.incident_id), alert = event.alert
        const trigger = { id: event.id, source: 'alertmanager', threads: [{ source: 'alertmanager', id: incident.id }],
          actor: { source: 'alertmanager', id: rules.instanceId }, human: false, at: event.at,
          text: `[${alert.status}] ${alert.labels.alertname ?? incident.plan.service}\n${alert.annotations.summary ?? alert.annotations.description ?? ''}`,
          meta: { incidentId: incident.id, service: incident.plan.service, cluster: incident.plan.cluster, status: alert.status } }
        await source.receive(trigger)
        source.threads.describe('alertmanager:' + incident.id, { label: `[${incident.status}] ${incident.plan.service} · ${incident.plan.alertname}`,
          facts: { mode: { label: { zh: '模式', en: 'Mode' }, value: rules.mode }, incident: { label: { zh: '事故', en: 'Incident' }, value: incident.id } } })
        store.forwarded(event.id)
      }
      if (adapter) await store.executeNext(adapter, rules)
      source.report('alertmanager', { state: 'ready', detail: rules.mode === 'observe' ? 'Observe: incident plans only; no IM requests' : 'Allowlisted incident execution enabled', at: new Date().toISOString() })
    }
    const tick = () => {
      if (stopped || busy) return
      busy = forward().catch(() => source.report('alertmanager', { state: 'error', detail: 'Incident processing failed; check configuration and bridge health' })).finally(() => { busy = undefined })
    }
    server = receiver({ token: readFileSync(config.tokenFile, 'utf8').trim(), enabled: refresh,
      accept: payload => { const result = store.ingest(payload, rules); tick(); return result } })
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve) })
    const disposeApi = ctx.webServer.register({ kind: 'prefix', path: '/alertmanager/api', handler: async (req, res) => {
      const origin = req.headers.origin
      if (req.headers['x-orchestrator-request'] !== '1' || (origin && origin !== `http://${req.headers.host}`)) { json(res, 403, { error: 'Same-origin request required' }); return }
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) { json(res, rejection, { error: 'DSH authentication required' }); return }
      if (req.method !== 'GET') { json(res, 405, { error: 'Read-only management API' }); return }
      const path = new URL(req.url, 'http://localhost').pathname
      if (path === '/alertmanager/api/incidents') json(res, 200, { mode: rules.mode, enabled: refresh(), items: store.list() })
      else if (/^\/alertmanager\/api\/incidents\/[a-f0-9]{32}$/.test(path)) {
        const incident = store.incident(path.split('/').at(-1)); json(res, incident ? 200 : 404, incident ? { ...incident, events: store.events(incident.id) } : { error: 'Incident not found' })
      } else json(res, 404, { error: 'Not found' })
    } })
    ctx.tools.register({ name: 'alertmanager_incidents', description: 'Read Alertmanager incident plans and delivery state. This tool cannot create groups or send messages.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: { schema: { type: 'object', properties: { mode: { type: 'string' }, items: { type: 'array', items: { type: 'object' } } }, required: ['mode', 'items'] }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: async () => ({ mode: rules.mode, items: store.list() }) })
    timer = setInterval(tick, 1000); tick()
    ctx.effect(() => async () => { stopped = true; clearInterval(timer); disposeApi(); await new Promise(resolve => server.close(resolve)); await busy; disposeKind(); store.close() })
  } catch (error) { stopped = true; clearInterval(timer); server?.close(); await busy; disposeKind(); store.close(); throw error }
}
