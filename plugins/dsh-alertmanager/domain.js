import { createHash } from 'node:crypto'

export class InputError extends Error { constructor(message, status = 400) { super(message); this.status = status } }
export const canonical = value => JSON.stringify(value, (_, v) => object(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)
export const hash = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32)
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value, name, max = 1024) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new InputError(`Invalid ${name}`)
  return value
}
function dictionary(value, name, max = 4096) {
  if (!object(value) || Object.keys(value).length > 100) throw new InputError(`Invalid ${name}`)
  const result = Object.create(null)
  for (const [key, item] of Object.entries(value)) {
    if (!key || key.length > 128 || typeof item !== 'string' || item.length > max) throw new InputError(`Invalid ${name} value`)
    result[key] = item
  }
  return result
}
const iso = (value, name) => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw new InputError(`Invalid ${name}`)
  return new Date(value).toISOString()
}
export function webhook(value) {
  if (!object(value) || value.version !== '4') throw new InputError('Alertmanager webhook version 4 is required')
  if (value.truncatedAlerts !== undefined && (!Number.isInteger(value.truncatedAlerts) || value.truncatedAlerts !== 0))
    throw new InputError('Truncated alert groups are not accepted; configure max_alerts: 0', 422)
  const receiver = text(value.receiver, 'receiver', 256), groupKey = text(value.groupKey, 'groupKey', 4096)
  if (!['firing', 'resolved'].includes(value.status) || !Array.isArray(value.alerts) || !value.alerts.length || value.alerts.length > 500)
    throw new InputError('Invalid webhook status or alert count (1–500)')
  const alerts = value.alerts.map(alert => {
    if (!object(alert) || !['firing', 'resolved'].includes(alert.status)) throw new InputError('Invalid alert status')
    const fingerprint = text(alert.fingerprint, 'fingerprint', 128), startsAt = iso(alert.startsAt, 'startsAt')
    const endsAt = alert.status === 'resolved' ? iso(alert.endsAt, 'endsAt') : undefined
    if (endsAt && endsAt < startsAt) throw new InputError('endsAt precedes startsAt')
    return { fingerprint, startsAt, ...(endsAt ? { endsAt } : {}), status: alert.status,
      labels: dictionary(alert.labels, 'labels'), annotations: dictionary(alert.annotations ?? {}, 'annotations') }
  })
  return { receiver, groupKey, alerts }
}
export function policy(value) {
  if (!object(value) || value.version !== 1 || !['observe', 'live'].includes(value.mode)) throw new InputError('Invalid incident policy')
  const instanceId = text(value.instanceId, 'instanceId', 128)
  if (!Array.isArray(value.routes) || value.routes.length > 100 || !Array.isArray(value.severities) || !value.severities.length)
    throw new InputError('Policy routes and severities are required')
  const severities = [...new Set(value.severities.map(x => text(x, 'severity', 64)))]
  const ids = new Set()
  const routes = value.routes.map(route => {
    if (!object(route) || !object(route.match)) throw new InputError('Invalid route')
    const id = text(route.id, 'route ID', 100)
    if (!/^[A-Za-z0-9_.-]+$/.test(id) || ids.has(id)) throw new InputError('Duplicate or invalid route ID')
    ids.add(id)
    const match = dictionary(route.match, 'route match', 256)
    if (!match.service || !Object.keys(match).length) throw new InputError('Each route must name a service')
    const ownerId = text(route.ownerId, 'owner ID', 128)
    if (!Array.isArray(route.memberIds) || !route.memberIds.length || route.memberIds.length > 30) throw new InputError('Route needs 1–30 members')
    const memberIds = [...new Set([ownerId, ...route.memberIds.map(x => text(x, 'member ID', 128))])]
    if (memberIds.some(x => !/^[A-Za-z0-9_.@-]+$/.test(x)) || memberIds.length > 30) throw new InputError('Invalid member ID or member limit exceeded')
    return { id, match, ownerId, memberIds }
  })
  let bridge
  if (value.bridge !== undefined) {
    if (!object(value.bridge)) throw new InputError('Invalid bridge')
    const url = new URL(text(value.bridge.url, 'bridge URL'))
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', 'host.docker.internal'].includes(url.hostname))))
      throw new InputError('Bridge needs HTTPS, or a local HTTP endpoint, without inline credentials')
    const tokenFile = text(value.bridge.tokenFile, 'bridge token file')
    if (!tokenFile.startsWith('/')) throw new InputError('Bridge tokenFile must be absolute')
    bridge = { url: url.href.replace(/\/$/, ''), tokenFile }
  }
  if (value.mode === 'live' && !bridge) throw new InputError('Live mode requires an authenticated VMI bridge')
  return { version: 1, instanceId, mode: value.mode, severities, routes, ...(bridge ? { bridge } : {}) }
}
export function routeFor(alert, rules) {
  if (!rules.severities.includes(alert.labels.severity)) return { reason: 'severity_not_allowed' }
  const matches = rules.routes.filter(route => Object.entries(route.match).every(([key, value]) => alert.labels[key] === value))
  return matches.length === 1 ? { route: matches[0] } : { reason: matches.length ? 'ambiguous_route' : 'service_not_allowed' }
}
export function planFor(incidentId, alert, route, now) {
  const service = alert.labels.service
  return { externalKey: incidentId, routeId: route.id, routingLabels: route.match, name: `[告警] ${service} ${now.slice(0, 16).replace('T', ' ')} UTC`.slice(0, 100),
    ownerId: route.ownerId, memberIds: route.memberIds, service, cluster: alert.labels.cluster ?? '',
    severity: alert.labels.severity, alertname: alert.labels.alertname ?? 'Alertmanager',
    summary: (alert.annotations.summary ?? alert.annotations.description ?? alert.labels.alertname ?? service).slice(0, 3000) }
}
export function messageFor(incident, phase) {
  const p = incident.plan
  return `${phase === 'resolved' ? '告警已恢复' : '告警协同'}\n服务：${p.service}\n集群：${p.cluster || '未指定'}\n级别：${p.severity}\n告警：${p.alertname}\n摘要（告警原文）：${p.summary}\n事故：${incident.id}\n${phase === 'resolved' ? '已收到当前事故所有已知告警的恢复事件。' : '请按值班流程确认影响与处理进度。'}`
}
