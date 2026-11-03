/** Incident jobs are distinct from Superagent coding Tickets and never grant model execution permissions. */
import { useEffect, useState } from 'react'
import { usePanel, usePanelData } from './provider.tsx'
import { Hint, Section, When } from './widgets.tsx'
interface Incident {
  id: string; status: string; mode: string; createdAt: string; updatedAt: string; groupId: string | null
  plan: { service: string; cluster: string; severity: string; alertname: string; summary: string; ownerId: string; memberIds: string[]; name: string }
  actions: { id: string; phase: string; state: string; attempts: number; error: string | null }[]
}
export function AlertmanagerPanel() {
  const { t, navigate } = usePanel()
  const { state } = usePanelData()
  const installed = !!state?.health && Object.hasOwn(state.health, 'alertmanager')
  const chinese = t('tab.overview') === '概览'
  const [data, setData] = useState<{ mode: string; enabled: boolean; items: Incident[] }>()
  const [error, setError] = useState(''), [open, setOpen] = useState<string>()
  useEffect(() => {
    if (!installed) return
    let stopped = false; const controller = new AbortController()
    const read = async () => {
      try {
        const r = await fetch('/alertmanager/api/incidents', { headers: { 'x-orchestrator-request': '1' }, signal: controller.signal })
        const text = await r.text()
        if (r.status === 404) { if (!stopped) { setData(undefined); setError('') }; return }
        if (!r.ok) throw Error(String(r.status))
        const value = JSON.parse(text) as { mode: string; enabled: boolean; items: Incident[] }
        if (!stopped) { setData(value); setError('') }
      } catch (e) { if (!stopped) setError(e instanceof Error ? e.message : 'Unavailable') }
    }
    void read(); const timer = setInterval(() => { void read() }, 4000)
    return () => { stopped = true; clearInterval(timer); controller.abort() }
  }, [installed])
  if (!data) return error ? <Hint>Alertmanager: {error}</Hint> : null
  const actionLabel = (value: string) => chinese ? ({ planned: '执行计划', pending: '等待重试', running: '执行中', sent: '已发送', failed: '执行失败', blocked: '规则变更，已拦截', skipped: '已恢复，跳过发送' } as Record<string, string>)[value] ?? value : value
  return <Section title={chinese ? 'Alertmanager 告警协同' : 'Alertmanager incidents'} count={data.items.length}>
    <Hint>{data.mode === 'observe' ? (chinese ? '仅生成计划：不建群、不拉人、不发送消息。事故任务独立于编码 Worker。' : 'Observe: plans only, no groups or messages. Incident jobs are separate from coding workers.')
      : (chinese ? '按服务和人员白名单自动执行；唯秘网关需支持持久幂等。' : 'Live delivery under service and member allowlists, with durable gateway idempotency.')}</Hint>
    {!data.enabled && <p className="dt-banner">{chinese ? 'Alertmanager 来源已关闭' : 'Alertmanager Source is disabled'}</p>}
    {!data.items.length && <Hint>{chinese ? '等待 Alertmanager 告警。首次接入可使用模拟告警验证。' : 'Waiting for alerts. Use a synthetic alert to verify the integration.'}</Hint>}
    <ul className="dt-list dt-cards">{data.items.map(i => <li className="dt-row" key={i.id}><div className="dt-row-main">
      <button type="button" className="dt-textlink" onClick={() => setOpen(open === i.id ? undefined : i.id)}>
        [{i.status === 'resolved' ? (chinese ? '已恢复' : 'Resolved') : (chinese ? '告警中' : 'Firing')}] {i.plan.service} · {i.plan.alertname}</button>
      <p>{i.plan.summary}</p><div className="dt-row-meta"><span>{i.plan.cluster}</span><span>{i.plan.severity}</span><When at={i.updatedAt} />
        {i.actions.map(a => <span key={a.id}>{actionLabel(a.state)}</span>)}</div>
      {open === i.id && <div>
        <p>{chinese ? '拟建群' : 'Group plan'}：{i.plan.name}</p>
        <p>{chinese ? '群主' : 'Owner'}：{i.plan.ownerId}</p><p>{chinese ? '成员' : 'Members'}：{i.plan.memberIds.join(', ')}</p>
        <p>{chinese ? '群 ID' : 'Group ID'}：{i.groupId ?? (chinese ? '未创建' : 'Not created')}</p>
        <p>{chinese ? '事故 ID' : 'Incident ID'}：<code>{i.id}</code></p>
        {i.actions.map(a => <p key={a.id}>{a.phase} · {actionLabel(a.state)} · {chinese ? '尝试次数' : 'Attempts'} {a.attempts}{a.error ? ` · ${a.error}` : ''}</p>)}
        <button type="button" className="dt-textlink" onClick={() => navigate({ page: 'trigger', id: 'alertmanager:' + i.id })}>{chinese ? '查看告警事件' : 'View alert events'}</button>
      </div>}
    </div></li>)}</ul>
  </Section>
}
