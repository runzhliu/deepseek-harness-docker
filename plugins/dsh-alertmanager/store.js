import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'
import { hash, routeFor, planFor, messageFor, canonical } from './domain.js'

export class IncidentStore {
  constructor(file, now = () => new Date().toISOString()) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(file); chmodSync(file, 0o600); this.now = now
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS incidents(id TEXT PRIMARY KEY, group_id TEXT NOT NULL, status TEXT NOT NULL, plan TEXT NOT NULL, mode TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, group_chat TEXT);
      CREATE TABLE IF NOT EXISTS alerts(id TEXT PRIMARY KEY, incident_id TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, incident_id TEXT NOT NULL, at TEXT NOT NULL, payload TEXT NOT NULL, forwarded INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS actions(id TEXT PRIMARY KEY, incident_id TEXT NOT NULL, phase TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at TEXT NOT NULL, error TEXT);
      CREATE INDEX IF NOT EXISTS incidents_group ON incidents(group_id,status);
      CREATE INDEX IF NOT EXISTS events_forwarded ON events(forwarded);
      CREATE INDEX IF NOT EXISTS actions_pending ON actions(state,next_at);`)
    this.db.prepare("UPDATE actions SET state='pending' WHERE state='running'").run()
  }
  atomic(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const value = fn(); this.db.exec('COMMIT'); return value } catch (error) { this.db.exec('ROLLBACK'); throw error } }
  incident(id) {
    const r = this.db.prepare('SELECT * FROM incidents WHERE id=?').get(id)
    return r && { id: r.id, status: r.status, plan: JSON.parse(r.plan), mode: r.mode, createdAt: r.created_at, updatedAt: r.updated_at,
      groupId: r.group_chat ?? null, actions: this.db.prepare('SELECT id,phase,state,attempts,error FROM actions WHERE incident_id=? ORDER BY rowid').all(id) }
  }
  list() { return this.db.prepare('SELECT id FROM incidents ORDER BY updated_at DESC,rowid DESC LIMIT 100').all().map(r => this.incident(r.id)) }
  ingest(payload, rules) {
    return this.atomic(() => {
      const changed = new Set(), ids = new Set(); let duplicate = 0, filtered = 0
      for (const alert of payload.alerts) {
        const routed = routeFor(alert, rules)
        if (!routed.route) { filtered++; continue }
        const route = routed.route, group = hash(rules.instanceId, payload.receiver, payload.groupKey, route.id)
        const alertId = hash(group, alert.fingerprint, alert.startsAt)
        const previous = this.db.prepare('SELECT * FROM alerts WHERE id=?').get(alertId)
        // Resolved alert instances are terminal, including when an HA replica delivers an older firing notification.
        if (previous?.status === 'resolved') { duplicate++; ids.add(previous.incident_id); continue }
        let incidentId = previous?.incident_id
        if (!incidentId && alert.status === 'firing') incidentId = this.db.prepare("SELECT id FROM incidents WHERE group_id=? AND status='firing' ORDER BY created_at DESC LIMIT 1").get(group)?.id
        incidentId ??= hash('incident', alertId)
        const encoded = canonical(alert), eventId = hash('event', alertId, alert.status, encoded)
        if (this.db.prepare('SELECT id FROM events WHERE id=?').get(eventId)) { duplicate++; ids.add(incidentId); continue }
        const at = this.now()
        if (!this.db.prepare('SELECT id FROM incidents WHERE id=?').get(incidentId)) {
          const plan = planFor(incidentId, alert, route, at)
          this.db.prepare('INSERT INTO incidents(id,group_id,status,plan,mode,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(incidentId, group, alert.status, JSON.stringify(plan), rules.mode, at, at)
          if (alert.status === 'firing') this.db.prepare('INSERT INTO actions(id,incident_id,phase,state,next_at) VALUES(?,?,?,?,?)').run(incidentId + ':firing', incidentId, 'firing', rules.mode === 'observe' ? 'planned' : 'pending', at)
        }
        this.db.prepare('INSERT INTO alerts(id,incident_id,status,payload) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,payload=excluded.payload').run(alertId, incidentId, alert.status, encoded)
        this.db.prepare('INSERT INTO events(id,incident_id,at,payload) VALUES(?,?,?,?)').run(eventId, incidentId, at, encoded)
        changed.add(incidentId); ids.add(incidentId)
      }
      for (const id of changed) {
        const firing = Number(this.db.prepare("SELECT count(*) AS n FROM alerts WHERE incident_id=? AND status='firing'").get(id).n)
        const before = this.incident(id), status = firing ? 'firing' : 'resolved', at = this.now()
        this.db.prepare('UPDATE incidents SET status=?,updated_at=? WHERE id=?').run(status, at, id)
        if (status === 'resolved' && before.status !== 'resolved') this.db.prepare('INSERT OR IGNORE INTO actions(id,incident_id,phase,state,next_at) VALUES(?,?,?,?,?)').run(id + ':resolved', id, 'resolved', before.mode === 'observe' ? 'planned' : 'pending', at)
      }
      return { incidents: [...ids], accepted: payload.alerts.length - duplicate - filtered, duplicate, filtered }
    })
  }
  events(id) { return this.db.prepare('SELECT id,at,payload FROM events WHERE incident_id=? ORDER BY rowid DESC LIMIT 100').all(id).reverse().map(r => ({ ...r, alert: JSON.parse(r.payload), payload: undefined })) }
  pendingEvents() { return this.db.prepare('SELECT id,incident_id,at,payload FROM events WHERE forwarded=0 ORDER BY rowid LIMIT 100').all().map(r => ({ ...r, alert: JSON.parse(r.payload) })) }
  forwarded(id) { this.db.prepare('UPDATE events SET forwarded=1 WHERE id=?').run(id) }
  pendingAction() {
    return this.db.prepare(`SELECT a.* FROM actions a WHERE a.state='pending' AND a.next_at<=? AND NOT EXISTS
      (SELECT 1 FROM actions prior WHERE prior.incident_id=a.incident_id AND prior.rowid<a.rowid AND prior.state IN ('pending','running')) ORDER BY a.rowid LIMIT 1`).get(this.now())
  }
  async executeNext(adapter, rules) {
    // Both incident mode and current operator policy must allow live execution.
    if (rules.mode !== 'live') return false
    const action = this.pendingAction(); if (!action) return false
    const incident = this.incident(action.incident_id)
    if (incident.mode !== 'live') return false
    const route = rules.routes.find(r => r.id === incident.plan.routeId && canonical(r.match) === canonical(incident.plan.routingLabels))
    if (!route || !rules.severities.includes(incident.plan.severity) || route.ownerId !== incident.plan.ownerId || JSON.stringify(route.memberIds) !== JSON.stringify(incident.plan.memberIds)) {
      this.db.prepare("UPDATE actions SET state='blocked',error='Policy changed; revalidation required' WHERE id=?").run(action.id); return true
    }
    if (incident.status === 'resolved' && !incident.groupId) {
      this.db.prepare("UPDATE actions SET state='skipped',error=NULL WHERE id=?").run(action.id); return true
    }
    this.db.prepare("UPDATE actions SET state='running',attempts=attempts+1 WHERE id=?").run(action.id)
    try {
      let groupId = incident.groupId
      if (!groupId) {
        groupId = await adapter.ensureGroup({ operationId: incident.id + ':group', ...incident.plan })
        this.db.prepare('UPDATE incidents SET group_chat=? WHERE id=?').run(groupId, incident.id)
      }
      await adapter.sendMessage({ groupId, operationId: action.id, text: messageFor(incident, action.phase) })
      this.db.prepare("UPDATE actions SET state='sent',error=NULL WHERE id=?").run(action.id)
    } catch (error) {
      const attempts = Number(action.attempts) + 1, next = new Date(Date.parse(this.now()) + Math.min(300, 5 * 2 ** (attempts - 1)) * 1000).toISOString()
      // Bridge bodies may contain credentials; persist only a controlled error code.
      this.db.prepare('UPDATE actions SET state=?,next_at=?,error=? WHERE id=?').run(attempts >= 8 || error.retryable === false ? 'failed' : 'pending', next, error.code ?? 'bridge_request_failed', action.id)
    }
    return true
  }
  close() { this.db.close() }
}
