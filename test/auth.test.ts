import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthFlow } from '../src/auth.js'
import { OAuthEndpoints } from '../src/oauth.js'
import { KeyStore } from '../src/storage.js'
import { LOFT_ENVIRONMENTS } from '../src/environments.js'
import { fakeStorage } from './helpers/fakeStorage.js'
import { fetchMock } from './helpers/fetchMock.js'
import type { FakeStorage } from './helpers/fakeStorage.js'

const staging = LOFT_ENVIRONMENTS.staging!

const META = {
  authorization_endpoint: 'https://mcp.staging.loft47.com/oauth/authorize',
  token_endpoint: 'https://mcp.staging.loft47.com/oauth/token',
  registration_endpoint: 'https://mcp.staging.loft47.com/oauth/register',
}

let storage: FakeStorage
let session: FakeStorage
let keys: KeyStore
let net: ReturnType<typeof fetchMock>
let navigate: ReturnType<typeof vi.fn>
let auth: AuthFlow
let registrationCount: number

beforeEach(() => {
  storage = fakeStorage()
  session = fakeStorage()
  keys = new KeyStore({ prefix: 'app', storage, session })
  keys.setEnvironmentId('staging')

  registrationCount = 0
  net = fetchMock()
  net.on('.well-known', { json: META })
  net.on('/oauth/register', () => {
    registrationCount += 1
    return {
      json: {
        client_id: `client-${registrationCount}`,
        // The server normalises the redirect_uri by appending a slash.
        redirect_uris: ['http://localhost:5173/'],
      },
    }
  })

  navigate = vi.fn()
  auth = new AuthFlow({
    keys,
    oauth: new OAuthEndpoints({ baseUrl: (env) => env.proxyPrefix, fetchImpl: net.impl }),
    env: () => staging,
    appName: 'Commission Audit',
    redirectUri: 'http://localhost:5173',
    navigate,
  })
})

function authorizeParams(): URLSearchParams {
  return new URL(navigate.mock.calls[0]![0] as string).searchParams
}

describe('signIn', () => {
  it('navigates to the absolute authorization endpoint, not the proxy', async () => {
    await auth.signIn()
    const url = navigate.mock.calls[0]![0] as string
    expect(url.startsWith('https://mcp.staging.loft47.com/oauth/authorize?')).toBe(true)
  })

  it('sends an S256 PKCE challenge and a code response type', async () => {
    await auth.signIn()
    const params = authorizeParams()
    expect(params.get('response_type')).toBe('code')
    expect(params.get('code_challenge_method')).toBe('S256')
    expect(params.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('stores the verifier in sessionStorage, never localStorage', async () => {
    await auth.signIn()
    expect(session.dump()['app:staging:pkce_verifier']).toBeTruthy()
    expect(storage.dump()['app:staging:pkce_verifier']).toBeUndefined()
  })

  it("sends the server's normalised redirect_uri, not the one requested", async () => {
    await auth.signIn()
    expect(authorizeParams().get('redirect_uri')).toBe('http://localhost:5173/')
  })

  it('registers a fresh client on every sign-in, never reusing a stored id', async () => {
    await auth.signIn()
    await auth.signIn()
    expect(registrationCount).toBe(2)
    expect(authorizeParams().get('client_id')).toBe('client-1')
    expect(new URL(navigate.mock.calls[1]![0] as string).searchParams.get('client_id')).toBe('client-2')
  })

  it('persists the registration so the token exchange can reuse it', async () => {
    await auth.signIn()
    expect(keys.read('client_id')).toBe('client-1')
    expect(keys.read('redirect_uri')).toBe('http://localhost:5173/')
  })

  it('does not navigate when registration fails', async () => {
    net.on('/oauth/register', { status: 500, text: 'boom' })
    await expect(auth.signIn()).rejects.toThrow(/500/)
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('completeSignIn', () => {
  beforeEach(async () => {
    await auth.signIn()
    net.on('/oauth/token', {
      json: { access_token: 'at', refresh_token: 'rt', expires_in: 1800 },
    })
  })

  it('exchanges the code and returns the raw token response', async () => {
    await expect(auth.completeSignIn('the-code')).resolves.toEqual({
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 1800,
    })
  })

  it('reuses the stored client rather than registering again', async () => {
    await auth.completeSignIn('the-code')
    expect(registrationCount).toBe(1)
  })

  it('sends the verifier, the stored client id and the normalised redirect_uri', async () => {
    await auth.completeSignIn('the-code')
    const body = new URLSearchParams(net.callsTo('/oauth/token')[0]!.body!)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('the-code')
    expect(body.get('client_id')).toBe('client-1')
    expect(body.get('redirect_uri')).toBe('http://localhost:5173/')
    expect(body.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('consumes the verifier so a replayed code cannot reuse it', async () => {
    await auth.completeSignIn('the-code')
    expect(session.dump()['app:staging:pkce_verifier']).toBeUndefined()
  })

  it('refuses when the verifier is missing', async () => {
    // Simulate a page reload: sessionStorage is cleared (no verifier), but
    // localStorage retains client_id and redirect_uri. Create a fresh KeyStore
    // with an empty memory map to test the real scenario.
    session.removeItem('app:staging:pkce_verifier')
    const reloadedKeys = new KeyStore({ prefix: 'app', storage, session })
    reloadedKeys.setEnvironmentId('staging')
    const reloadedAuth = new AuthFlow({
      keys: reloadedKeys,
      oauth: new OAuthEndpoints({ baseUrl: (env) => env.proxyPrefix, fetchImpl: net.impl }),
      env: () => staging,
      appName: 'Commission Audit',
      redirectUri: 'http://localhost:5173',
      navigate,
    })
    await expect(reloadedAuth.completeSignIn('the-code')).rejects.toThrow(/verifier/i)
  })

  it('surfaces the server description when the exchange is rejected', async () => {
    net.on('/oauth/token', {
      status: 400,
      json: { error: 'invalid_grant', error_description: 'Authorization code expired' },
    })
    await expect(auth.completeSignIn('the-code')).rejects.toThrow('Authorization code expired')
  })

  it('keeps the verifier when the exchange fails, so a retry is possible', async () => {
    net.on('/oauth/token', { status: 400, json: { error: 'invalid_grant' } })
    await expect(auth.completeSignIn('the-code')).rejects.toThrow()
    expect(session.dump()['app:staging:pkce_verifier']).toBeTruthy()
  })
})

describe('refresh', () => {
  it('posts a refresh grant with the stored client id and classifies success', async () => {
    await auth.signIn()
    net.on('/oauth/token', { json: { access_token: 'at2', expires_in: 1800 } })

    const outcome = await auth.refresh('rt')
    expect(outcome).toEqual({ ok: true, raw: { access_token: 'at2', expires_in: 1800 } })

    const body = new URLSearchParams(net.callsTo('/oauth/token')[0]!.body!)
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('rt')
    expect(body.get('client_id')).toBe('client-1')
    expect(body.get('code_verifier')).toBeNull()
  })

  it('classifies a revoked grant as permanent', async () => {
    await auth.signIn()
    net.on('/oauth/token', { status: 400, json: { error: 'invalid_grant' } })
    expect(await auth.refresh('rt')).toMatchObject({ ok: false, transient: false })
  })

  it('classifies a 503 as transient', async () => {
    await auth.signIn()
    net.on('/oauth/token', { status: 503, text: 'down' })
    expect(await auth.refresh('rt')).toMatchObject({ ok: false, transient: true })
  })

  it('registers a client when none is stored, so a reload can still refresh', async () => {
    // A reload leaves the refresh token in localStorage but the in-memory client
    // gone; registration must be re-derivable.
    keys.write('refresh_token', 'rt')
    net.on('/oauth/token', { json: { access_token: 'at2', expires_in: 1800 } })

    expect(await auth.refresh('rt')).toMatchObject({ ok: true })
    expect(registrationCount).toBe(1)
  })
})
