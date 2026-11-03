import { readFileSync } from 'node:fs'
import { InputError } from './domain.js'

export class BridgeError extends Error {
  constructor(code, retryable = true) { super(code); this.code = code; this.retryable = retryable }
}
export class VmiBridge {
  constructor(config, request = fetch) { this.config = config; this.request = request }
  async call(path, body) {
    const token = readFileSync(this.config.tokenFile, 'utf8').trim()
    if (token.length < 32 || token.length > 4096 || /\s/.test(token)) throw new BridgeError('bridge_token_invalid', false)
    let response
    try { response = await this.request(this.config.url + path, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json', 'idempotency-key': body.operationId } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }) } catch { throw new BridgeError('bridge_unreachable') }
    if (!response.ok) { await response.body?.cancel(); throw new BridgeError('bridge_http_' + response.status, response.status === 408 || response.status === 429 || response.status >= 500) }
    let result
    try { const text = await response.text(); if (text.length > 16384) throw Error(); result = JSON.parse(text) } catch { throw new BridgeError('bridge_response_invalid', false) }
    return result
  }
  async verify() {
    const c = await this.call('/v1/capabilities')
    if (c.version !== 1 || c.durableIdempotency !== true || c.ensureGroup !== true || c.sendMessage !== true)
      throw new BridgeError('bridge_idempotency_contract_required', false)
  }
  async ensureGroup(plan) {
    await this.verify()
    const result = await this.call('/v1/groups/ensure', {
      operationId: plan.operationId, externalKey: plan.externalKey, name: plan.name, ownerId: plan.ownerId, memberIds: plan.memberIds,
    })
    if (typeof result.groupId !== 'string' || !/^[A-Za-z0-9_.:@-]{1,200}$/.test(result.groupId)) throw new BridgeError('bridge_group_id_invalid', false)
    return result.groupId
  }
  async sendMessage(message) {
    if (typeof message.groupId !== 'string' || !message.groupId) throw new InputError('Missing group ID')
    await this.verify()
    const result = await this.call('/v1/groups/' + encodeURIComponent(message.groupId) + '/messages', { operationId: message.operationId, text: message.text })
    if (result.sent !== true) throw new BridgeError('bridge_delivery_unconfirmed', false)
  }
}
