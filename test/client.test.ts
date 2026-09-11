import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLoftMcpClient } from '../src/client'
import { AuthExpiredError, NoEnvironmentError } from '../src/errors'
import { fakeStorage } from './helpers/fakeStorage'
import { fetchMock } from './helpers/fetchMock'
import type { FakeStorage } from './helpers/fakeStorage'
import type { LoftMcpClient } from '../src/client'

const META = {
  authorization_endpoint: 'https://mcp.staging.loft47.com/oauth/authorize',
  token_endpoint: 'https://mcp.staging.loft47.com/oauth/token',
  registration_endpoint: 'https://mcp.staging.loft47.com/oauth/register',
}

const ok = (payload: unknown) => ({
  json: { jsonrpc: '2.0', id: 1, result: { content: [{ text: JSON.stringify(payload) }] } },
})

let storage: FakeStorage
let session: FakeStorage
let net: ReturnType<typeof fetchMock>
let navigate: ReturnType<typeof vi.fn>
let client: LoftMcpClient

function build() {
  return createLoftMcpClient({
    appName: 'Commission Audit',
    storagePrefix: 'commission_audit',
    appVersion: '0.1.0',
    redirectUri: 'http://localhost:5173',
    storage,
    sessionStore: session,
    navigate,
    fetchImpl: net.impl,
  })
}

beforeEach(() => {
  storage = fakeStorage()
  session = fakeStorage()
  navigate = vi.fn()
  net = fetchMock()
  net.on('.well-known', { json: META })
  net.on('/oauth/register', { json: { client_id: 'c1', redirect_uris: ['http://localhost:5173/'] } })
  net.on('/oauth/token', { json: { access_token: 'at', refresh_token: 'rt', expires_in: 1800 } })
  client = build()
})

afterEach(() => client.dispose())

describe('environment gate', () => {
  it('exposes the shipped registry and starts with nothing selected', () => {
    expect(client.environments.map((e) => e.id)).toEqual(['staging', 'production'])
    expect(client.environment).toBeNull()
  })

  it('never throws when reading the environment', () => {
    expect(() => client.environment).not.toThrow()
  })

  it('selects and persists', () => {
    client.setEnvironment('staging')
    expect(client.environment?.id).toBe('staging')
    expect(storage.dump()['commission_audit:environment']).toBe('staging')
  })

  it('rejects an id that is not in the registry', () => {
    expect(() => client.setEnvironment('nowhere')).toThrow(/unknown environment/i)
  })

  it('throws NoEnvironmentError from calls that need one', async () => {
    await expect(client.signIn()).rejects.toThrow(NoEnvironmentError)
    expect(() => client.scopedKey('x')).toThrow(NoEnvironmentError)
  })

  it('survives a reload by reading the stored choice', () => {
    client.setEnvironment('production')
    expect(build().environment?.id).toBe('production')
  })
})

describe('sign-in through to a tool call', () => {
  beforeEach(() => client.setEnvironment('staging'))

  it('completes the exchange, stores the token and reports authenticated', async () => {
    expect(client.isAuthenticated).toBe(false)
    await client.signIn()
    await client.completeSignIn('the-code')
    expect(client.isAuthenticated).toBe(true)
    expect(await client.getAccessToken()).toBe('at')
  })

  it('lets an app call an arbitrary tool it did not have to declare here', async () => {
    await client.signIn()
    await client.completeSignIn('the-code')
    net.on('/mcp', ok({ data: [{ id: '1', type: 'deal' }] }))

    await expect(client.call('ListDeals', { brokerage_id: 45 })).resolves.toEqual({
      data: [{ id: '1', type: 'deal' }],
    })
  })
})

describe('identity and brokerage', () => {
  beforeEach(async () => {
    client.setEnvironment('staging')
    await client.signIn()
    await client.completeSignIn('the-code')
  })

  it('loads identity from the token', async () => {
    net.on('/mcp', ok({ data: { id: '7', type: 'userinfo', attributes: { sub: '7', name: 'Dana' } } }))
    await expect(client.loadIdentity()).resolves.toMatchObject({ sub: '7', name: 'Dana' })
    expect(client.identity?.name).toBe('Dana')
  })

  it('remembers the chosen brokerage', () => {
    expect(client.brokerageId).toBeNull()
    client.setBrokerage(45)
    expect(client.brokerageId).toBe(45)
    expect(build().brokerageId).toBe(45)
  })

  it('namespaces app keys by environment and brokerage', () => {
    client.setBrokerage(45)
    expect(client.scopedKey('rules')).toBe('commission_audit:staging:rules')
    expect(client.brokerageKey('rules')).toBe('commission_audit:staging:45:rules')
    expect(client.brokerageKey('rules', 99)).toBe('commission_audit:staging:99:rules')
  })

  it('refuses a brokerage key when no brokerage is chosen', () => {
    expect(() => client.brokerageKey('rules')).toThrow(/no brokerage/i)
  })
})

describe('environment isolation', () => {
  it('never lets a staging token or identity reach production', async () => {
    client.setEnvironment('staging')
    await client.signIn()
    await client.completeSignIn('the-code')
    net.on('/mcp', ok({ data: { id: '7', type: 'userinfo', attributes: { sub: '7', name: 'Staging Dana' } } }))
    await client.loadIdentity()
    client.setBrokerage(45)

    client.setEnvironment('production')
    expect(client.isAuthenticated).toBe(false)
    expect(client.identity).toBeNull()
    expect(client.brokerageId).toBeNull()

    client.setEnvironment('staging')
    expect(client.isAuthenticated).toBe(true)
    expect(client.identity?.name).toBe('Staging Dana')
    expect(client.brokerageId).toBe(45)
  })
})

describe('revoke — spec §7 three-tier table', () => {
  const APP_KEY = 'commission_audit:staging:45:log'

  beforeEach(async () => {
    client.setEnvironment('staging')
    await client.signIn()
    await client.completeSignIn('the-code')
    client.setBrokerage(45)
    storage.seed(APP_KEY, '["audit trail"]')
  })

  it('clears credentials, identity, session, environment and brokerage', () => {
    client.revoke()
    expect(client.isAuthenticated).toBe(false)
    expect(client.identity).toBeNull()
    expect(client.environment).toBeNull()
    expect(storage.dump()['commission_audit:staging:mcp_session']).toBeUndefined()
    expect(storage.dump()['commission_audit:staging:brokerage_id']).toBeUndefined()
  })

  it('leaves app state alone by default', () => {
    client.revoke()
    expect(storage.dump()[APP_KEY]).toBe('["audit trail"]')
  })

  it('removes app state when purging', () => {
    client.revoke({ purge: true })
    expect(storage.dump()[APP_KEY]).toBeUndefined()
  })

  it('leaves another app on the same origin untouched when purging', () => {
    storage.seed('other_app:staging:token', 'theirs')
    client.revoke({ purge: true })
    expect(storage.dump()['other_app:staging:token']).toBe('theirs')
  })
})

describe('subscribe', () => {
  it('notifies on environment, auth, identity and brokerage changes', async () => {
    const listener = vi.fn()
    client.subscribe(listener)

    client.setEnvironment('staging')
    expect(listener).toHaveBeenCalledTimes(1)

    await client.signIn()
    await client.completeSignIn('the-code')
    expect(listener).toHaveBeenCalledTimes(2)

    client.setBrokerage(45)
    expect(listener).toHaveBeenCalledTimes(3)

    client.revoke()
    expect(listener).toHaveBeenCalledTimes(4)
  })

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn()
    client.subscribe(listener)()
    client.setEnvironment('staging')
    expect(listener).not.toHaveBeenCalled()
  })

  it('lets one listener throw without stopping the others', () => {
    const good = vi.fn()
    client.subscribe(() => {
      throw new Error('bad listener')
    })
    client.subscribe(good)
    expect(() => client.setEnvironment('staging')).not.toThrow()
    expect(good).toHaveBeenCalled()
  })
})

describe('mcp session survives an environment round trip — Finding 2', () => {
  it('reuses a previously-established session after switching away and back, without re-running initialize', async () => {
    net.on('/mcp', { ...ok({ data: [] }), headers: { 'Mcp-Session-Id': 'sess-a' } })

    client.setEnvironment('staging')
    await client.signIn()
    await client.completeSignIn('the-code')
    await client.call('ListDeals', {})

    const initializeCalls = () =>
      net.calls.filter((c) => c.body?.includes('"method":"initialize"')).length
    expect(initializeCalls()).toBe(1)
    expect(storage.dump()['commission_audit:staging:mcp_session']).toBe('sess-a')

    client.setEnvironment('production')
    client.setEnvironment('staging')

    await client.call('ListDeals', {})
    expect(initializeCalls()).toBe(1) // still 1: the stored session was reused, not re-initialized
  })
})

describe('clearEnvironment leaves credentials intact — Correction 3 / Finding 3', () => {
  it('deselects the environment without clearing its token, identity or brokerage default', async () => {
    client.setEnvironment('staging')
    await client.signIn()
    await client.completeSignIn('the-code')
    net.on('/mcp', ok({ data: { id: '7', type: 'userinfo', attributes: { sub: '7', name: 'Dana' } } }))
    await client.loadIdentity()
    client.setBrokerage(45)

    client.clearEnvironment()
    expect(client.environment).toBeNull()

    client.setEnvironment('staging')
    expect(client.isAuthenticated).toBe(true)
    expect(client.identity?.name).toBe('Dana')
    expect(client.brokerageId).toBe(45)
  })
})

describe('renewal timer re-arms on environment change — Correction 2', () => {
  it('arms the timer against a token already stored for a newly-selected environment', async () => {
    vi.useFakeTimers()
    try {
      // Nothing selected yet at construction time, so the constructor's own
      // arm() was a no-op. Seed staging with a token as if a prior session
      // (or another tab) had already signed in, then switch into it.
      storage.seed('commission_audit:staging:token', 'at')
      storage.seed('commission_audit:staging:refresh_token', 'rt')
      const expiresAt = Date.now() + 1800 * 1000
      storage.seed('commission_audit:staging:expires_at', String(expiresAt))

      net.on('/oauth/token', { json: { access_token: 'renewed', refresh_token: 'rt2', expires_in: 1800 } })

      client.setEnvironment('staging')

      // Default skew is 120s, so the timer should fire at expiresAt - 120s.
      await vi.advanceTimersByTimeAsync(1800 * 1000 - 120 * 1000)

      expect(net.callsTo('/oauth/token').length).toBeGreaterThan(0)
      expect(storage.dump()['commission_audit:staging:token']).toBe('renewed')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('401 on a locally-fresh token — Finding C1', () => {
  beforeEach(async () => {
    client.setEnvironment('staging')
    await client.signIn()
    await client.completeSignIn('the-code')
  })

  // Every other 401 test in this repo stubs `forceRefresh` with a vi.fn(), so
  // none of them ever reaches TokenManager.performRefresh(). These wire the
  // real manager end to end, because the bug lived in exactly the seam the
  // stubs replaced: performRefresh() short-circuits when the token is not
  // stale, and a 401 on a locally-fresh token (clock skew, server-side
  // revocation, or an expiry the server never told us) is precisely a forced
  // refresh of a token that looks fine from here.
  it('refreshes anyway and retries, instead of re-presenting the dead token', async () => {
    const exchanges = net.callsTo('/oauth/token').length
    net.on('/oauth/token', { json: { access_token: 'at2', refresh_token: 'rt2', expires_in: 1800 } })
    net.on('/mcp', (call) =>
      call.headers.Authorization === 'Bearer at'
        ? { status: 401, text: 'expired' }
        : ok({ data: [{ id: '1', type: 'deal' }] }),
    )

    await expect(client.call('ListDeals')).resolves.toEqual({ data: [{ id: '1', type: 'deal' }] })
    expect(net.callsTo('/oauth/token').length - exchanges).toBe(1)
    expect(client.isAuthenticated).toBe(true)
    expect(await client.getAccessToken()).toBe('at2')
  })

  it('coalesces concurrent 401s onto a single refresh POST', async () => {
    const exchanges = net.callsTo('/oauth/token').length
    net.on('/oauth/token', { json: { access_token: 'at2', refresh_token: 'rt2', expires_in: 1800 } })
    net.on('/mcp', (call) =>
      call.headers.Authorization === 'Bearer at'
        ? { status: 401, text: 'expired' }
        : ok({ data: [] }),
    )

    await Promise.all(
      Array.from({ length: 6 }, (_, i) => client.call('ListDeals', { page_number: i })),
    )
    expect(net.callsTo('/oauth/token').length - exchanges).toBe(1)
  })

  it('still short-circuits when another tab already replaced the token', async () => {
    // Not a forced refresh: the token this caller holds is no longer the one
    // stored, so the multi-tab guarantee (and test/tokens.test.ts's
    // "short-circuits when another tab refreshed" case) must still hold.
    const exchanges = net.callsTo('/oauth/token').length
    storage.seed('commission_audit:staging:token', 'from-other-tab')
    net.on('/mcp', (call) =>
      call.headers.Authorization === 'Bearer at'
        ? { status: 401, text: 'expired' }
        : ok({ data: [] }),
    )

    await expect(client.call('ListDeals')).resolves.toEqual({ data: [] })
    expect(net.callsTo('/oauth/token').length - exchanges).toBe(0)
  })

  it('reports a permanently dead session to onAuthExpired exactly once', async () => {
    const onAuthExpired = vi.fn()
    client.dispose()
    client = createLoftMcpClient({
      appName: 'Commission Audit',
      storagePrefix: 'commission_audit',
      appVersion: '0.1.0',
      redirectUri: 'http://localhost:5173',
      storage,
      sessionStore: session,
      navigate,
      fetchImpl: net.impl,
      onAuthExpired,
    })
    net.on('/mcp', { status: 401, text: 'expired' })
    net.on('/oauth/token', { status: 400, json: { error: 'invalid_grant' } })

    await expect(client.call('ListDeals')).rejects.toThrow(AuthExpiredError)
    // TokenManager.giveUp() fires onExpired and throws; Transport catches that
    // same AuthExpiredError and reports it again. One dead session, one call.
    expect(onAuthExpired).toHaveBeenCalledTimes(1)
  })

  it('reports the next dead session too — the latch is per death, not per client', async () => {
    const onAuthExpired = vi.fn()
    client.dispose()
    client = createLoftMcpClient({
      appName: 'Commission Audit',
      storagePrefix: 'commission_audit',
      appVersion: '0.1.0',
      redirectUri: 'http://localhost:5173',
      storage,
      sessionStore: session,
      navigate,
      fetchImpl: net.impl,
      onAuthExpired,
    })
    net.on('/mcp', { status: 401, text: 'expired' })
    net.on('/oauth/token', { status: 400, json: { error: 'invalid_grant' } })
    await expect(client.call('ListDeals')).rejects.toThrow(AuthExpiredError)
    expect(onAuthExpired).toHaveBeenCalledTimes(1)

    // Sign in again, then die again. A latch that never reopens would swallow
    // this one and strand the app on a session it thinks is still alive.
    net.on('/oauth/token', { json: { access_token: 'at3', refresh_token: 'rt3', expires_in: 1800 } })
    await client.signIn()
    await client.completeSignIn('another-code')
    net.on('/oauth/token', { status: 400, json: { error: 'invalid_grant' } })

    await expect(client.call('ListDeals')).rejects.toThrow(AuthExpiredError)
    expect(onAuthExpired).toHaveBeenCalledTimes(2)
  })
})

describe('revoke with no environment selected — Finding I1', () => {
  // revoke() was the one un-guarded sibling: tokens.clear() reached
  // keys.remove(), which throws NoEnvironmentError before identity.clear(),
  // transport.resetSession() or keys.purge() could run — so spec §7's
  // `:unset:` orphan sweep was unreachable through the public API.
  beforeEach(() => {
    storage.seed('commission_audit:unset:token', 'orphan from the old code')
    storage.seed('commission_audit:staging:45:log', '["audit trail"]')
    storage.seed('other_app:staging:token', 'a different app on this origin')
  })

  it('does not throw in the default mode', () => {
    expect(client.environment).toBeNull()
    expect(() => client.revoke()).not.toThrow()
  })

  it('purges, sweeping the :unset: orphans, and still spares another prefix', () => {
    expect(() => client.revoke({ purge: true })).not.toThrow()
    expect(storage.dump()['commission_audit:unset:token']).toBeUndefined()
    expect(storage.dump()['commission_audit:staging:45:log']).toBeUndefined()
    expect(storage.dump()['other_app:staging:token']).toBe('a different app on this origin')
  })

  it('purges after the environment was deselected mid-session', async () => {
    client.setEnvironment('staging')
    await client.signIn()
    await client.completeSignIn('the-code')
    client.clearEnvironment()

    expect(() => client.revoke({ purge: true })).not.toThrow()
    expect(storage.dump()['commission_audit:staging:token']).toBeUndefined()
    expect(storage.dump()['commission_audit:unset:token']).toBeUndefined()
  })
})

describe('NoEnvironmentError beats AuthExpiredError — Finding I2', () => {
  // Spec §6: a caller has to be able to tell "nothing chosen yet" from a real
  // failure. Reading the token first found nothing stored and reported the
  // session as expired, with no request ever made.
  it('throws NoEnvironmentError from call()', async () => {
    await expect(client.call('ListDeals')).rejects.toThrow(NoEnvironmentError)
  })

  it('throws NoEnvironmentError from getAccessToken()', async () => {
    await expect(client.getAccessToken()).rejects.toThrow(NoEnvironmentError)
  })

  it('throws NoEnvironmentError from loadIdentity()', async () => {
    await expect(client.loadIdentity()).rejects.toThrow(NoEnvironmentError)
  })

  it('throws NoEnvironmentError from listBrokerages()', async () => {
    await expect(client.listBrokerages()).rejects.toThrow(NoEnvironmentError)
  })

  it('still reports AuthExpiredError once an environment is chosen but no token is stored', async () => {
    client.setEnvironment('staging')
    await expect(client.call('ListDeals')).rejects.toThrow(AuthExpiredError)
  })
})
