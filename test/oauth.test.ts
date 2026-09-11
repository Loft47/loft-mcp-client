import { beforeEach, describe, expect, it } from 'vitest'
import { OAuthEndpoints } from '../src/oauth.js'
import { LOFT_ENVIRONMENTS } from '../src/environments.js'
import { fetchMock } from './helpers/fetchMock.js'

const staging = LOFT_ENVIRONMENTS.staging!
const production = LOFT_ENVIRONMENTS.production!

const META = {
  authorization_endpoint: 'https://mcp.staging.loft47.com/oauth/authorize',
  token_endpoint: 'https://mcp.staging.loft47.com/oauth/token',
  registration_endpoint: 'https://mcp.staging.loft47.com/oauth/register',
}

let net: ReturnType<typeof fetchMock>
let oauth: OAuthEndpoints

beforeEach(() => {
  net = fetchMock()
  net.on('/.well-known/oauth-authorization-server', { json: META })
  oauth = new OAuthEndpoints({ baseUrl: (env) => env.proxyPrefix, fetchImpl: net.impl })
})

describe('discovery', () => {
  it('fetches through the environment base URL, never the absolute host', async () => {
    await oauth.meta(staging)
    expect(net.calls[0]!.url).toBe('/loft/staging/.well-known/oauth-authorization-server')
    expect(net.calls[0]!.url).not.toContain('https://')
  })

  it('caches per environment', async () => {
    await oauth.meta(staging)
    await oauth.meta(staging)
    expect(net.callsTo('.well-known')).toHaveLength(1)
  })

  it('does not share a cache entry between environments', async () => {
    await oauth.meta(staging)
    await oauth.meta(production)
    expect(net.callsTo('.well-known')).toHaveLength(2)
    expect(net.calls[1]!.url).toBe('/loft/production/.well-known/oauth-authorization-server')
  })

  it('names the environment when discovery fails', async () => {
    net.on('.well-known', { status: 503, text: 'upstream down' })
    await expect(oauth.meta(staging)).rejects.toThrow(/Staging.*503/)
  })
})

describe('toFetchUrl', () => {
  it('rewrites an absolute endpoint on the MCP host to the base URL', () => {
    expect(oauth.toFetchUrl(staging, META.token_endpoint)).toBe('/loft/staging/oauth/token')
  })

  it('preserves the query string', () => {
    expect(oauth.toFetchUrl(staging, 'https://mcp.staging.loft47.com/oauth/token?a=1')).toBe(
      '/loft/staging/oauth/token?a=1',
    )
  })

  it('tolerates a relative endpoint', () => {
    expect(oauth.toFetchUrl(staging, '/oauth/token')).toBe('/loft/staging/oauth/token')
  })
})

describe('register', () => {
  beforeEach(() => {
    net.on('/oauth/register', {
      json: {
        client_id: 'client-abc',
        // The server normalises what we send by appending a trailing slash.
        redirect_uris: ['http://localhost:5173/'],
      },
    })
  })

  it('posts through the base URL', async () => {
    await oauth.register(staging, { appName: 'Commission Audit', redirectUri: 'http://localhost:5173' })
    expect(net.callsTo('/oauth/register')[0]!.url).toBe('/loft/staging/oauth/register')
  })

  it('requests a public client using PKCE', async () => {
    await oauth.register(staging, { appName: 'Commission Audit', redirectUri: 'http://localhost:5173' })
    const body = JSON.parse(net.callsTo('/oauth/register')[0]!.body!)
    expect(body).toMatchObject({
      client_name: 'Commission Audit',
      redirect_uris: ['http://localhost:5173'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    })
  })

  it("returns the server's normalised redirect_uri, not the one requested", async () => {
    const client = await oauth.register(staging, {
      appName: 'Commission Audit',
      redirectUri: 'http://localhost:5173',
    })
    expect(client).toEqual({ clientId: 'client-abc', redirectUri: 'http://localhost:5173/' })
  })

  it('falls back to the requested redirect_uri when the server echoes none', async () => {
    net.on('/oauth/register', { json: { client_id: 'client-xyz' } })
    const client = await oauth.register(staging, {
      appName: 'App',
      redirectUri: 'http://localhost:5173',
    })
    expect(client.redirectUri).toBe('http://localhost:5173')
  })

  it('throws when the response carries no client_id', async () => {
    net.on('/oauth/register', { json: { error: 'nope' } })
    await expect(
      oauth.register(staging, { appName: 'App', redirectUri: 'http://x' }),
    ).rejects.toThrow(/no client_id/i)
  })

  it('throws when the server has no registration endpoint', async () => {
    net.on('.well-known', { json: { authorization_endpoint: 'a', token_endpoint: 'b' } })
    await expect(
      oauth.register(staging, { appName: 'App', redirectUri: 'http://x' }),
    ).rejects.toThrow(/dynamic registration/i)
  })

  it('surfaces the body when registration is rejected', async () => {
    net.on('/oauth/register', { status: 422, text: 'redirect_uri is invalid' })
    await expect(
      oauth.register(staging, { appName: 'App', redirectUri: 'http://x' }),
    ).rejects.toThrow(/422.*redirect_uri is invalid/)
  })
})

describe('postToken', () => {
  it('form-encodes through the base URL and reports status with data', async () => {
    net.on('/oauth/token', { json: { access_token: 'at', expires_in: 1800 } })
    const result = await oauth.postToken(staging, { grant_type: 'refresh_token', refresh_token: 'rt' })

    const call = net.callsTo('/oauth/token')[0]!
    expect(call.url).toBe('/loft/staging/oauth/token')
    expect(call.method).toBe('POST')
    expect(call.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(call.body).toBe('grant_type=refresh_token&refresh_token=rt')
    expect(result).toEqual({ status: 200, data: { access_token: 'at', expires_in: 1800 } })
  })

  it('reports a non-JSON error body as data-less rather than throwing', async () => {
    net.on('/oauth/token', { status: 500, text: '<html>Internal Server Error</html>' })
    const result = await oauth.postToken(staging, { grant_type: 'refresh_token' })
    expect(result.status).toBe(500)
    expect(result.data).toEqual({})
  })

  it('reports a network failure without throwing', async () => {
    net.on('/oauth/token', { networkError: 'Failed to fetch' })
    const result = await oauth.postToken(staging, { grant_type: 'refresh_token' })
    expect(result.status).toBe(0)
    expect(result.networkError).toBeInstanceOf(TypeError)
  })

  it('returns a sentinel when discovery fails with a non-2xx response', async () => {
    // Fresh instance with no cached meta; discovery will fail
    const freshOAuth = new OAuthEndpoints({ baseUrl: (env) => env.proxyPrefix, fetchImpl: net.impl })
    net.on('/.well-known/oauth-authorization-server', { status: 503, text: 'Service unavailable' })
    const result = await freshOAuth.postToken(staging, { grant_type: 'refresh_token' })
    expect(result.status).toBe(0)
    expect(result.data).toEqual({})
    expect(result.networkError).toBeInstanceOf(Error)
  })

  it('returns a sentinel when discovery fails at the network level', async () => {
    // Fresh instance with no cached meta; discovery network call will fail
    const freshOAuth = new OAuthEndpoints({ baseUrl: (env) => env.proxyPrefix, fetchImpl: net.impl })
    net.on('/.well-known/oauth-authorization-server', { networkError: 'Network timeout' })
    const result = await freshOAuth.postToken(staging, { grant_type: 'refresh_token' })
    expect(result.status).toBe(0)
    expect(result.data).toEqual({})
    expect(result.networkError).toBeInstanceOf(TypeError)
  })
})
