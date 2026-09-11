import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { createLoftMcpClient } from '../src/client'
import { LoftMcpProvider, useLoftMcp } from '../src/react'
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
const userinfo = ok({ data: { id: '7', type: 'userinfo', attributes: { sub: '7', name: 'Dana' } } })
const brokerageRow = (id: number, name: string) => ({
  id: String(id), type: 'brokerage',
  attributes: { id, name, legalName: null, franchiseName: null, country: 'CA', currency: 'CAD', inactiveDate: null },
})

let storage: FakeStorage
let net: ReturnType<typeof fetchMock>
let client: LoftMcpClient

/** Renders the hook's state as text so assertions read as user-visible states. */
function Probe() {
  const { status, error, identity, brokerages, brokerageId } = useLoftMcp()
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="error">{error ?? ''}</span>
      <span data-testid="identity">{identity?.name ?? ''}</span>
      <span data-testid="brokerage">{brokerageId ?? ''}</span>
      <span data-testid="choices">{brokerages?.map((b) => b.name).join(',') ?? ''}</span>
    </div>
  )
}

function mount(autoSelectSingle = true) {
  return render(
    <LoftMcpProvider client={client} autoSelectSingle={autoSelectSingle}>
      <Probe />
    </LoftMcpProvider>,
  )
}

const status = () => screen.getByTestId('status').textContent

beforeEach(() => {
  window.history.replaceState({}, '', '/')
  storage = fakeStorage()
  net = fetchMock()
  net.on('.well-known', { json: META })
  net.on('/oauth/register', { json: { client_id: 'c1', redirect_uris: ['http://localhost:5173/'] } })
  net.on('/oauth/token', { json: { access_token: 'at', refresh_token: 'rt', expires_in: 1800 } })
  client = createLoftMcpClient({
    appName: 'Test App',
    storagePrefix: 'test_app',
    redirectUri: 'http://localhost:5173',
    storage,
    sessionStore: fakeStorage(),
    navigate: vi.fn(),
    fetchImpl: net.impl,
  })
})

afterEach(() => {
  // The project's vitest config does not set `test.globals`, so
  // @testing-library/react's automatic afterEach(cleanup) never registers
  // (it detects a global `afterEach`, which isn't present) — without this,
  // every render in this file piles up in the same jsdom document and
  // `getByTestId` starts finding more than one match.
  cleanup()
  client.dispose()
})

describe('the gate sequence', () => {
  it('starts at the environment picker', () => {
    mount()
    expect(status()).toBe('choose-environment')
  })

  it('moves to connect once an environment is chosen', async () => {
    mount()
    act(() => client.setEnvironment('staging'))
    await waitFor(() => expect(status()).toBe('connect'))
  })

  it('moves through identifying to the brokerage picker after sign-in', async () => {
    net.on('/mcp', userinfo)
    client.setEnvironment('staging')
    await client.signIn()
    mount()

    await act(async () => {
      await client.completeSignIn('the-code')
    })
    await waitFor(() => expect(screen.getByTestId('identity').textContent).toBe('Dana'))
    await waitFor(() => expect(status()).toBe('choose-brokerage'))
  })

  // The case above only asserts the states on either side of `'identifying'`
  // (no identity yet, then identity present) — nothing in the suite asserted
  // the transient status itself, so a mistyped or broken `identifying` rung
  // in the status ladder would go unnoticed (`grep -n "identifying"` matched
  // only a test name, never an assertion). Made observable the same way as
  // `'connecting'`: hold the `GetUserinfo` response on a promise this test
  // controls, so `'identifying'` is the literal current state at the moment
  // of assertion, not an inference from its neighbours.
  it('shows identifying while the identity lookup is in flight', async () => {
    net.on('/mcp', userinfo)
    let releaseIdentity: () => void = () => {}
    const pendingIdentity = new Promise<void>((resolve) => {
      releaseIdentity = resolve
    })
    const delayedFetch: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      const isGetUserinfo =
        url.includes('/mcp') &&
        typeof init?.body === 'string' &&
        JSON.parse(init.body).params?.name === 'GetUserinfo'
      if (isGetUserinfo) await pendingIdentity
      return net.impl(input, init)
    }

    const delayedClient = createLoftMcpClient({
      appName: 'Test App',
      storagePrefix: 'test_app_identifying',
      redirectUri: 'http://localhost:5173',
      storage: fakeStorage(),
      sessionStore: fakeStorage(),
      navigate: vi.fn(),
      fetchImpl: delayedFetch,
    })
    delayedClient.setEnvironment('staging')
    await delayedClient.signIn()
    await delayedClient.completeSignIn('the-code')

    render(
      <LoftMcpProvider client={delayedClient}>
        <Probe />
      </LoftMcpProvider>,
    )
    expect(status()).toBe('identifying')

    releaseIdentity()
    await waitFor(() => expect(status()).toBe('choose-brokerage'))
    delayedClient.dispose()
  })

  it('reaches ready once a brokerage is chosen', async () => {
    net.on('/mcp', userinfo)
    client.setEnvironment('staging')
    await client.signIn()
    await client.completeSignIn('the-code')
    client.setBrokerage(45)
    mount()

    await waitFor(() => expect(status()).toBe('ready'))
  })

  it('goes straight to ready on a reload with everything remembered', async () => {
    net.on('/mcp', userinfo)
    client.setEnvironment('staging')
    await client.signIn()
    await client.completeSignIn('the-code')
    await client.loadIdentity()
    client.setBrokerage(45)

    const revived = createLoftMcpClient({
      appName: 'Test App', storagePrefix: 'test_app', redirectUri: 'http://localhost:5173',
      storage, sessionStore: fakeStorage(), navigate: vi.fn(), fetchImpl: net.impl,
    })
    render(
      <LoftMcpProvider client={revived}>
        <Probe />
      </LoftMcpProvider>,
    )
    await waitFor(() => expect(status()).toBe('ready'))
    revived.dispose()
  })
})

describe('the OAuth callback', () => {
  it('exchanges a ?code= and scrubs it from the URL', async () => {
    net.on('/mcp', userinfo)
    client.setEnvironment('staging')
    await client.signIn()
    window.history.replaceState({}, '', '/?code=the-code')

    mount()
    await waitFor(() => expect(window.location.search).toBe(''))
    await waitFor(() => expect(client.isAuthenticated).toBe(true))
  })

  // CORRECTED from the brief: the original scaffolding registered a
  // `/oauth/token` route that threw synchronously, immediately overrode it
  // with a working one, and bound an unused `release`. It could not exercise
  // "in flight" at all — the exchange either fails synchronously (before
  // `mount`, on a call the test never awaits — a dropped rejection, not
  // an assertable state) or, after the override, resolves as soon as any
  // awaited step lets its microtask run.
  //
  // Expressed here as a dedicated client whose `fetchImpl` forwards every
  // route to the shared mock except `/oauth/token`, which awaits a promise
  // this test controls. That makes "in flight" real: the exchange cannot
  // settle until the test calls `release()`, so asserting `status()`
  // synchronously right after `mount()` (no `await` in between) is checking
  // a state that is genuinely still pending, not a race against a mock that
  // was always going to resolve on the next microtask anyway.
  it('shows connecting while the exchange is in flight', async () => {
    let release: () => void = () => {}
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const delayedFetch: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/oauth/token')) await pending
      return net.impl(input, init)
    }

    const delayedClient = createLoftMcpClient({
      appName: 'Test App',
      storagePrefix: 'test_app_delayed',
      redirectUri: 'http://localhost:5173',
      storage: fakeStorage(),
      sessionStore: fakeStorage(),
      navigate: vi.fn(),
      fetchImpl: delayedFetch,
    })
    delayedClient.setEnvironment('staging')
    await delayedClient.signIn()
    window.history.replaceState({}, '', '/?code=the-code')

    render(
      <LoftMcpProvider client={delayedClient}>
        <Probe />
      </LoftMcpProvider>,
    )
    expect(status()).toBe('connecting')

    release()
    await waitFor(() => expect(delayedClient.isAuthenticated).toBe(true))
    delayedClient.dispose()
  })

  // The identity- and brokerage-loading effects both guard their
  // `.then`/`.catch` with a `cancelled` flag set on cleanup; the exchange
  // effect above did not, so an unmount while `completeSignIn` was in flight
  // let its continuation run anyway — `setExchanging(false)`, possibly
  // `setError(...)`, and a `window.history.replaceState(...)` fired from a
  // torn-down provider. Reuses the blocking-`fetchImpl` technique from
  // "shows connecting" to unmount while the exchange is still pending, then
  // resolves it and confirms nothing fires afterward.
  it('does not touch the URL after unmounting mid-exchange', async () => {
    let release: () => void = () => {}
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const delayedFetch: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/oauth/token')) await pending
      return net.impl(input, init)
    }

    const delayedClient = createLoftMcpClient({
      appName: 'Test App',
      storagePrefix: 'test_app_unmount',
      redirectUri: 'http://localhost:5173',
      storage: fakeStorage(),
      sessionStore: fakeStorage(),
      navigate: vi.fn(),
      fetchImpl: delayedFetch,
    })
    delayedClient.setEnvironment('staging')
    await delayedClient.signIn()
    window.history.replaceState({}, '', '/?code=the-code')

    const replaceStateSpy = vi.spyOn(window.history, 'replaceState')
    const view = render(
      <LoftMcpProvider client={delayedClient}>
        <Probe />
      </LoftMcpProvider>,
    )
    expect(status()).toBe('connecting')

    view.unmount()
    release()
    await waitFor(() => expect(delayedClient.isAuthenticated).toBe(true))
    expect(replaceStateSpy).not.toHaveBeenCalled()

    delayedClient.dispose()
  })

  it('surfaces an exchange failure as the error status', async () => {
    client.setEnvironment('staging')
    await client.signIn()
    net.on('/oauth/token', { status: 400, json: { error_description: 'Authorization code expired' } })
    window.history.replaceState({}, '', '/?code=stale')

    mount()
    await waitFor(() => expect(status()).toBe('error'))
    expect(screen.getByTestId('error').textContent).toBe('Authorization code expired')
  })

  it('exchanges only once even across re-renders', async () => {
    net.on('/mcp', userinfo)
    client.setEnvironment('staging')
    await client.signIn()
    window.history.replaceState({}, '', '/?code=the-code')

    const view = mount()
    await waitFor(() => expect(client.isAuthenticated).toBe(true))
    view.rerender(
      <LoftMcpProvider client={client}>
        <Probe />
      </LoftMcpProvider>,
    )
    await waitFor(() => expect(net.callsTo('/oauth/token')).toHaveLength(1))
  })

  // Strengthens the case above: a plain `rerender()` with unchanged props
  // never re-runs the exchange effect regardless of the ref guard, because
  // React bails out when an effect's own dependencies haven't changed — so
  // that assertion alone would still pass with the guard deleted. StrictMode
  // double-invokes effects on mount (setup, cleanup, setup), which *does*
  // re-run this effect body with the same `code` still in the URL — the same
  // shape as two mounts racing to exchange it. Only the `exchangedCode` ref
  // stops that second run from calling `completeSignIn` again.
  it('exchanges only once under StrictMode double-invocation', async () => {
    net.on('/mcp', userinfo)
    client.setEnvironment('staging')
    await client.signIn()
    window.history.replaceState({}, '', '/?code=the-code')

    render(
      <StrictMode>
        <LoftMcpProvider client={client}>
          <Probe />
        </LoftMcpProvider>
      </StrictMode>,
    )
    await waitFor(() => expect(client.isAuthenticated).toBe(true))
    expect(net.callsTo('/oauth/token')).toHaveLength(1)
  })
})

describe('the brokerage picker', () => {
  beforeEach(async () => {
    client.setEnvironment('staging')
    await client.signIn()
    await client.completeSignIn('the-code')
  })

  it('loads the choices, sorted', async () => {
    net.on('/mcp', (call) =>
      JSON.parse(call.body!).params?.name === 'GetUserinfo'
        ? userinfo
        : ok({ data: [brokerageRow(99, 'Zenith'), brokerageRow(45, 'Acme')] }),
    )
    mount(false)
    await waitFor(() => expect(screen.getByTestId('choices').textContent).toBe('Acme,Zenith'))
    expect(status()).toBe('choose-brokerage')
  })

  it('selects automatically when there is exactly one', async () => {
    net.on('/mcp', (call) =>
      JSON.parse(call.body!).params?.name === 'GetUserinfo'
        ? userinfo
        : ok({ data: [brokerageRow(45, 'Acme')] }),
    )
    mount(true)
    await waitFor(() => expect(status()).toBe('ready'))
    expect(screen.getByTestId('brokerage').textContent).toBe('45')
  })

  it('does not auto-select when the option is off', async () => {
    net.on('/mcp', (call) =>
      JSON.parse(call.body!).params?.name === 'GetUserinfo'
        ? userinfo
        : ok({ data: [brokerageRow(45, 'Acme')] }),
    )
    mount(false)
    await waitFor(() => expect(screen.getByTestId('choices').textContent).toBe('Acme'))
    expect(status()).toBe('choose-brokerage')
  })

  it('stays on the picker when the account has none', async () => {
    net.on('/mcp', (call) =>
      JSON.parse(call.body!).params?.name === 'GetUserinfo' ? userinfo : ok({ data: [] }),
    )
    mount()
    await waitFor(() => expect(screen.getByTestId('choices').textContent).toBe(''))
    expect(status()).toBe('choose-brokerage')
  })
})

describe('leaving', () => {
  it('switchBrokerage returns to the picker without signing out', async () => {
    net.on('/mcp', (call) =>
      JSON.parse(call.body!).params?.name === 'GetUserinfo'
        ? userinfo
        : ok({ data: [brokerageRow(45, 'Acme'), brokerageRow(99, 'Zenith')] }),
    )
    client.setEnvironment('staging')
    await client.signIn()
    await client.completeSignIn('the-code')
    client.setBrokerage(45)
    mount(false)
    await waitFor(() => expect(status()).toBe('ready'))

    act(() => client.clearBrokerage())
    await waitFor(() => expect(status()).toBe('choose-brokerage'))
    expect(client.isAuthenticated).toBe(true)
  })

  it('revoke returns all the way to the environment picker', async () => {
    net.on('/mcp', userinfo)
    client.setEnvironment('staging')
    await client.signIn()
    await client.completeSignIn('the-code')
    client.setBrokerage(45)
    mount()
    await waitFor(() => expect(status()).toBe('ready'))

    act(() => client.revoke())
    await waitFor(() => expect(status()).toBe('choose-environment'))
  })
})

describe('useLoftMcp outside a provider', () => {
  it('throws a message naming the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/LoftMcpProvider/)
    spy.mockRestore()
  })
})
