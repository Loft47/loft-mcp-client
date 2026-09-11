import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Transport } from '../src/transport'
import { KeyStore } from '../src/storage'
import { AuthExpiredError } from '../src/errors'
import { fakeStorage } from './helpers/fakeStorage'
import { fetchMock } from './helpers/fetchMock'
import type { FakeStorage } from './helpers/fakeStorage'

/** A JSON-RPC success envelope carrying `payload` as the tool's JSON text. */
const ok = (payload: unknown) => ({
  json: { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(payload) }] } },
})

let storage: FakeStorage
let keys: KeyStore
let net: ReturnType<typeof fetchMock>
let getAccessToken: ReturnType<typeof vi.fn>
let forceRefresh: ReturnType<typeof vi.fn>
let onAuthExpired: ReturnType<typeof vi.fn>
let transport: Transport

function build(maxConcurrent = 6): Transport {
  return new Transport({
    keys,
    endpoint: () => '/loft/staging/mcp',
    getAccessToken: getAccessToken as unknown as () => Promise<string>,
    forceRefresh: forceRefresh as unknown as (knownBadToken: string) => Promise<string>,
    onAuthExpired,
    clientInfo: { name: 'test-app', version: '0.1.0' },
    maxConcurrent,
    fetchImpl: net.impl,
  })
}

beforeEach(() => {
  storage = fakeStorage()
  keys = new KeyStore({ prefix: 'app', storage, session: fakeStorage() })
  keys.setEnvironmentId('staging')
  net = fetchMock()
  getAccessToken = vi.fn().mockResolvedValue('access-token')
  forceRefresh = vi.fn().mockResolvedValue('new-token')
  onAuthExpired = vi.fn()
  transport = build()
})

describe('the initialize handshake', () => {
  it('initializes once, before the first tool call', async () => {
    net.on('/mcp', ok({ data: [] }))
    await transport.call('ListDeals')
    await transport.call('ListDeals', { page_number: 2 })

    const bodies = net.callsTo('/mcp').map((c) => JSON.parse(c.body!))
    expect(bodies[0].method).toBe('initialize')
    expect(bodies[0].params.clientInfo).toEqual({ name: 'test-app', version: '0.1.0' })
    expect(bodies.filter((b) => b.method === 'initialize')).toHaveLength(1)
  })

  // Finding I3: `initialized` used to flip only after its POST resolved, with
  // no latch, so N cold calls arriving together each sent their own handshake
  // and stranded N-1 server-side sessions.
  it('sends one handshake for six cold parallel calls, not six', async () => {
    net.on('/mcp', ok({ data: [] }))
    // A real async boundary inside `fetch`, so all six calls are genuinely in
    // flight before the first handshake can resolve and set `initialized`.
    // (fetchMock's own responders run synchronously and cannot hold one open.)
    const slow: typeof fetch = async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      return net.impl(...args)
    }
    const cold = new Transport({
      keys,
      endpoint: () => '/loft/staging/mcp',
      getAccessToken: getAccessToken as unknown as () => Promise<string>,
      forceRefresh: forceRefresh as unknown as (knownBadToken: string) => Promise<string>,
      onAuthExpired,
      clientInfo: { name: 'test-app', version: '0.1.0' },
      maxConcurrent: 6,
      fetchImpl: slow,
    })

    await Promise.all(Array.from({ length: 6 }, (_, i) => cold.call('ListDeals', { page: i })))

    const bodies = net.callsTo('/mcp').map((c) => JSON.parse(c.body!))
    expect(bodies.filter((b) => b.method === 'initialize')).toHaveLength(1)
    expect(bodies.filter((b) => b.method === 'tools/call')).toHaveLength(6)
  })

  it('skips the handshake when a session was already stored', async () => {
    storage.seed('app:staging:mcp_session', 'session-from-last-time')
    const revived = build()
    revived.primeSession()
    net.on('/mcp', ok({ data: [] }))

    await revived.call('ListDeals')
    const bodies = net.callsTo('/mcp').map((c) => JSON.parse(c.body!))
    expect(bodies.every((b) => b.method !== 'initialize')).toBe(true)
  })
})

describe('requests', () => {
  beforeEach(() => net.on('/mcp', ok({ data: [] })))

  it('sends the bearer token and accepts both response media types', async () => {
    await transport.call('ListDeals')
    const headers = net.callsTo('/mcp')[0]!.headers
    expect(headers.Authorization).toBe('Bearer access-token')
    expect(headers.Accept).toBe('application/json, text/event-stream')
  })

  it('wraps the tool name and arguments in a JSON-RPC tools/call', async () => {
    await transport.call('ListDeals', { brokerage_id: 45 })
    const body = JSON.parse(net.callsTo('/mcp').at(-1)!.body!)
    expect(body.method).toBe('tools/call')
    expect(body.params).toEqual({ name: 'ListDeals', arguments: { brokerage_id: 45 } })
    expect(body.jsonrpc).toBe('2.0')
  })

  it('defaults arguments to an empty object', async () => {
    await transport.call('GetUserinfo')
    const body = JSON.parse(net.callsTo('/mcp').at(-1)!.body!)
    expect(body.params.arguments).toEqual({})
  })

  it('parses the tool payload out of the content envelope', async () => {
    net.on('/mcp', ok({ data: [{ id: '1', type: 'deal' }] }))
    await expect(transport.call('ListDeals')).resolves.toEqual({ data: [{ id: '1', type: 'deal' }] })
  })
})

describe('the MCP session', () => {
  it('captures Mcp-Session-Id and echoes it on later calls', async () => {
    net.on('/mcp', { ...ok({ data: [] }), headers: { 'Mcp-Session-Id': 'session-abc' } })
    await transport.call('ListDeals')
    await transport.call('ListDeals', { page_number: 2 })

    expect(storage.dump()['app:staging:mcp_session']).toBe('session-abc')
    expect(net.callsTo('/mcp').at(-1)!.headers['Mcp-Session-Id']).toBe('session-abc')
  })

  it('forgets the session on reset', async () => {
    net.on('/mcp', { ...ok({ data: [] }), headers: { 'Mcp-Session-Id': 'session-abc' } })
    await transport.call('ListDeals')
    transport.resetSession()
    expect(storage.dump()['app:staging:mcp_session']).toBeUndefined()
  })
})

describe('response formats', () => {
  it('reads an SSE data frame', async () => {
    const envelope = { jsonrpc: '2.0', id: 1, result: { content: [{ text: '{"data":[]}' }] } }
    net.on('/mcp', {
      text: `event: message\ndata: ${JSON.stringify(envelope)}\n\n`,
      headers: { 'Content-Type': 'text/event-stream' },
    })
    await expect(transport.call('ListDeals')).resolves.toEqual({ data: [] })
  })

  it('skips non-JSON frames and keeps scanning', async () => {
    const envelope = { jsonrpc: '2.0', id: 1, result: { content: [{ text: '{"data":[]}' }] } }
    net.on('/mcp', {
      text: `data: keep-alive\ndata: ${JSON.stringify(envelope)}\n\n`,
      headers: { 'Content-Type': 'text/event-stream' },
    })
    await expect(transport.call('ListDeals')).resolves.toEqual({ data: [] })
  })

  it('errors when an SSE response carries no data frame', async () => {
    net.on('/mcp', { text: ': comment only\n\n', headers: { 'Content-Type': 'text/event-stream' } })
    await expect(transport.call('ListDeals')).rejects.toThrow(/no data frame/i)
  })
})

describe('errors', () => {
  it('surfaces a JSON-RPC error message', async () => {
    net.on('/mcp', { json: { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } } })
    await expect(transport.call('Nope')).rejects.toThrow('Method not found')
  })

  it('surfaces the in-band text of a tool-level isError, naming the tool', async () => {
    // This text is the only description of what actually broke; swallowing it
    // is a one-character regression, so it gets its own test.
    net.on('/mcp', {
      json: {
        jsonrpc: '2.0',
        id: 1,
        result: { isError: true, content: [{ text: 'Upstream returned 422: brokerage_id is required' }] },
      },
    })
    await expect(transport.call('ListDeals')).rejects.toThrow(
      /ListDeals failed.*brokerage_id is required/,
    )
  })

  it('truncates a long error body rather than throwing a wall of HTML', async () => {
    const html = `<html>${'x'.repeat(2000)}</html>`
    net.on('/mcp', { json: { jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ text: html }] } } })
    await expect(transport.call('ListDeals')).rejects.toThrow(/…$/)
  })

  it('reports a non-JSON tool payload as such', async () => {
    net.on('/mcp', {
      json: { jsonrpc: '2.0', id: 1, result: { content: [{ text: '<html>Internal Server Error</html>' }] } },
    })
    await expect(transport.call('ListDeals')).rejects.toThrow(/non-JSON response/)
  })

  // Finding I5: the test above covers a non-JSON payload *inside* a valid
  // JSON-RPC envelope. This is the other branch — the HTTP response itself is
  // not JSON at all, which is what a gateway or an unhandled Rails exception
  // actually returns. `res.json()` gave "Unexpected token '<'" with no tool
  // name, no status and no body.
  it('reports an HTML 500 from /mcp with the tool, the status and a truncated body', async () => {
    net.on('/mcp', {
      status: 500,
      text: '<html><body><h1>Internal Server Error</h1></body></html>',
      headers: { 'Content-Type': 'text/html' },
    })
    await expect(transport.call('ListDeals')).rejects.toThrow(
      /initialize returned a non-JSON HTTP 500 — <html>.*Internal Server Error/,
    )
  })

  it('truncates an enormous HTML error page rather than throwing the whole document', async () => {
    net.on('/mcp', {
      status: 502,
      text: `<html>${'x'.repeat(5000)}</html>`,
      headers: { 'Content-Type': 'text/html' },
    })
    await expect(transport.call('ListDeals')).rejects.toThrow(/non-JSON HTTP 502 —.*…$/)
  })

  it('names the tool, not the handshake, when the HTML 500 comes after initialize', async () => {
    net.on('/mcp', ok({ data: [] }))
    await transport.call('ListDeals') // handshake done
    net.on('/mcp', {
      status: 500,
      text: '<html>Internal Server Error</html>',
      headers: { 'Content-Type': 'text/html' },
    })
    await expect(transport.call('GetDealFinancials', { deal_id: 1 })).rejects.toThrow(
      /GetDealFinancials returned a non-JSON HTTP 500/,
    )
  })

  it('errors on an empty content envelope', async () => {
    net.on('/mcp', { json: { jsonrpc: '2.0', id: 1, result: { content: [] } } })
    await expect(transport.call('ListDeals')).rejects.toThrow(/empty response/i)
  })
})

describe('401 recovery', () => {
  it('refreshes once and retries with the new token', async () => {
    let seen = 0
    net.on('/mcp', () => {
      seen += 1
      return seen === 1 ? { status: 401, text: 'expired' } : ok({ data: [] })
    })

    // getAccessToken and forceRefresh are mocked independently in this file, but
    // in real use both are bound to the same TokenManager (Task 8), so a refresh
    // is visible to the very next pre-flight read. A fresh transport's first
    // call also triggers the initialize handshake, which is what actually hits
    // this 401 — model that shared state here rather than two disconnected
    // static mocks, or the assertion below could never hold regardless of
    // whether the transport really propagates the refreshed token forward.
    let currentToken = 'access-token'
    getAccessToken.mockImplementation(() => Promise.resolve(currentToken))
    forceRefresh.mockImplementation(() => {
      currentToken = 'new-token'
      return Promise.resolve(currentToken)
    })

    await expect(transport.call('ListDeals')).resolves.toEqual({ data: [] })
    expect(forceRefresh).toHaveBeenCalledOnce()
    expect(net.callsTo('/mcp').at(-1)!.headers.Authorization).toBe('Bearer new-token')
  })

  it('gives up after a second 401, clearing the session and notifying', async () => {
    net.on('/mcp', { status: 401, text: 'expired' })
    await expect(transport.call('ListDeals')).rejects.toThrow(AuthExpiredError)
    expect(onAuthExpired).toHaveBeenCalledOnce()
    expect(storage.dump()['app:staging:mcp_session']).toBeUndefined()
  })

  it('gives up when the refresh itself fails with a permanent auth failure', async () => {
    net.on('/mcp', { status: 401, text: 'expired' })
    forceRefresh.mockRejectedValue(new AuthExpiredError('invalid_grant'))
    await expect(transport.call('ListDeals')).rejects.toThrow(AuthExpiredError)
    expect(net.callsTo('/mcp')).toHaveLength(1)
    expect(onAuthExpired).toHaveBeenCalledOnce()
  })

  it('propagates a transient refresh failure without ending the session', async () => {
    // TokenManager throws a plain Error (not AuthExpiredError) for a network
    // blip or 5xx, and deliberately keeps every credential — see spec §6. The
    // transport must not convert that into a sign-out.
    net.on('/mcp', { ...ok({ data: [] }), headers: { 'Mcp-Session-Id': 'session-abc' } })
    await transport.call('ListDeals') // establishes a stored MCP session
    net.on('/mcp', { status: 401, text: 'expired' })
    forceRefresh.mockRejectedValue(new Error('network error'))

    await expect(transport.call('ListDeals')).rejects.toThrow('network error')
    await expect(transport.call('ListDeals')).rejects.not.toThrow(AuthExpiredError)
    expect(onAuthExpired).not.toHaveBeenCalled()
    expect(storage.dump()['app:staging:mcp_session']).toBe('session-abc')
  })
})

describe('concurrency and de-duplication', () => {
  it('never exceeds the concurrency cap', async () => {
    net.on('/mcp', ok({ data: [] }))

    // The mock responder itself runs synchronously with no `await` inside it,
    // so counting overlap there can never observe interleaving — a call and
    // its bookkeeping complete before the next call's bookkeeping can run,
    // regardless of whether the cap works, is set to 500, or is deleted
    // outright. Wrap the fetch implementation instead, where a real async
    // boundary (the `setTimeout`) holds a call genuinely in flight long
    // enough for concurrent calls to actually overlap.
    let inFlight = 0
    let peak = 0
    const counting: typeof fetch = async (...args) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      try {
        await new Promise((resolve) => setTimeout(resolve, 1))
        return await net.impl(...args)
      } finally {
        inFlight -= 1
      }
    }

    const limited = new Transport({
      keys,
      endpoint: () => '/loft/staging/mcp',
      getAccessToken: getAccessToken as unknown as () => Promise<string>,
      forceRefresh: forceRefresh as unknown as (knownBadToken: string) => Promise<string>,
      onAuthExpired,
      clientInfo: { name: 'test-app', version: '0.1.0' },
      maxConcurrent: 2,
      fetchImpl: counting,
    })
    await Promise.all(Array.from({ length: 10 }, (_, i) => limited.call('ListDeals', { page: i })))
    expect(peak).toBeLessThanOrEqual(2)
  })

  it('collapses identical concurrent calls into one request', async () => {
    net.on('/mcp', ok({ data: [] }))
    await Promise.all([
      transport.call('GetDealFinancials', { deal_id: 1 }),
      transport.call('GetDealFinancials', { deal_id: 1 }),
      transport.call('GetDealFinancials', { deal_id: 1 }),
    ])
    const toolCalls = net.callsTo('/mcp').filter((c) => JSON.parse(c.body!).method === 'tools/call')
    expect(toolCalls).toHaveLength(1)
  })

  it('does not collapse calls with different arguments', async () => {
    net.on('/mcp', ok({ data: [] }))
    await Promise.all([
      transport.call('GetDealFinancials', { deal_id: 1 }),
      transport.call('GetDealFinancials', { deal_id: 2 }),
    ])
    const toolCalls = net.callsTo('/mcp').filter((c) => JSON.parse(c.body!).method === 'tools/call')
    expect(toolCalls).toHaveLength(2)
  })

  it('hits the network again once the first call has settled', async () => {
    net.on('/mcp', ok({ data: [] }))
    await transport.call('GetDealFinancials', { deal_id: 1 })
    await transport.call('GetDealFinancials', { deal_id: 1 })
    const toolCalls = net.callsTo('/mcp').filter((c) => JSON.parse(c.body!).method === 'tools/call')
    expect(toolCalls).toHaveLength(2)
  })

  it('releases the concurrency slot when a call fails', async () => {
    net.on('/mcp', { json: { jsonrpc: '2.0', id: 1, error: { message: 'boom' } } })
    const limited = build(1)
    await expect(limited.call('A')).rejects.toThrow('boom')
    net.on('/mcp', ok({ data: [] }))
    await expect(limited.call('B')).resolves.toEqual({ data: [] })
  })
})
