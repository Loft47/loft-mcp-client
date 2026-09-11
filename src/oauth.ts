/**
 * Everything this library says to the MCP server's OAuth endpoints: discovery,
 * dynamic client registration (RFC 7591) and the token endpoint.
 *
 * Two rules hold throughout, both learned the hard way:
 *
 *  1. Discovery advertises absolute URLs on the MCP host, and the host sends no
 *     CORS headers. Anything reached with `fetch` must therefore be rewritten to
 *     the same-origin base URL. `authorization_endpoint` is the sole exception —
 *     it is a top-level navigation, handled in `auth.ts`, and keeps its absolute
 *     URL because its session cookie belongs to the real host.
 *  2. Registration returns a normalised `redirect_uris[0]` — the server appends
 *     a trailing slash. Both `authorize` and the token exchange must present the
 *     server's value verbatim or the redirect_uri check fails, so callers get
 *     back what the server said, not what they asked for.
 *
 * One thing that looks wrong and is not: registration sends
 * `token_endpoint_auth_method: 'none'`, and the server's discovery document
 * does **not** list `none` in `token_endpoint_auth_methods_supported`. Sending
 * it anyway is correct. This is a PKCE public client with no secret to present,
 * and RFC 7591's default for an omitted `token_endpoint_auth_method` is
 * `client_secret_basic` — which would register the client as confidential and
 * break the token exchange. It demonstrably works against this host. Do not
 * "fix" it by matching the advertised list.
 */

import type { LoftEnvironment } from './environments.js'

export interface OAuthMeta {
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint?: string
}

export interface RegisteredClient {
  clientId: string
  redirectUri: string
}

export interface TokenEndpointResult {
  /** 0 when the request never reached the server. */
  status: number
  /** Parsed JSON body, or `{}` when the body was not JSON (a Rails HTML 500). */
  data: Record<string, unknown>
  networkError?: unknown
}

export interface OAuthOptions {
  baseUrl: (env: LoftEnvironment) => string
  fetchImpl?: typeof fetch
}

export class OAuthEndpoints {
  private readonly baseUrl: (env: LoftEnvironment) => string
  private readonly fetchImpl: typeof fetch
  /** Per environment: the two servers advertise different endpoints. */
  private readonly metaCache = new Map<string, OAuthMeta>()

  constructor(opts: OAuthOptions) {
    this.baseUrl = opts.baseUrl
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  async meta(env: LoftEnvironment): Promise<OAuthMeta> {
    const cached = this.metaCache.get(env.id)
    if (cached) return cached

    const url = `${this.baseUrl(env)}/.well-known/oauth-authorization-server`
    const res = await this.fetchImpl(url)
    if (!res.ok) throw new Error(`OAuth discovery failed against ${env.label}: ${res.status}`)

    const meta = (await res.json()) as OAuthMeta
    this.metaCache.set(env.id, meta)
    return meta
  }

  /** Rewrites an endpoint on the MCP host to the same-origin base URL. */
  toFetchUrl(env: LoftEnvironment, endpoint: string): string {
    const base = this.baseUrl(env)
    try {
      const parsed = new URL(endpoint)
      return `${base}${parsed.pathname}${parsed.search}`
    } catch {
      // Already relative.
      return `${base}${endpoint}`
    }
  }

  /**
   * Registers a new client, always. The server keeps registrations on its own
   * container filesystem, which does not survive a redeploy — and it is
   * redeployed whenever the API gains a route, since it reads the OpenAPI spec
   * only at boot. A stale client id sends the browser to a server-rendered
   * "client ID was not found" page that a single-page app never sees and cannot
   * recover from, so a cached id is a liability rather than an optimisation.
   */
  async register(
    env: LoftEnvironment,
    opts: { appName: string; redirectUri: string },
  ): Promise<RegisteredClient> {
    const meta = await this.meta(env)
    if (!meta.registration_endpoint) {
      throw new Error('MCP server does not support dynamic registration')
    }

    const res = await this.fetchImpl(this.toFetchUrl(env, meta.registration_endpoint), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: opts.appName,
        redirect_uris: [opts.redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
    })
    if (!res.ok) throw new Error(`Client registration failed: ${res.status} — ${await res.text()}`)

    const data = (await res.json()) as { client_id?: string; redirect_uris?: string[] }
    if (!data.client_id) throw new Error('Registration response contained no client_id')

    return {
      clientId: data.client_id,
      redirectUri: data.redirect_uris?.[0] ?? opts.redirectUri,
    }
  }

  /**
   * Posts to the token endpoint. Never throws for a server or network failure —
   * the status and body are returned so `tokens.ts` can decide whether the
   * failure is permanent (drop the session) or transient (keep it).
   */
  async postToken(
    env: LoftEnvironment,
    params: Record<string, string>,
  ): Promise<TokenEndpointResult> {
    let res: Response
    try {
      const meta = await this.meta(env)
      res = await this.fetchImpl(this.toFetchUrl(env, meta.token_endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
      })
    } catch (networkError) {
      return { status: 0, data: {}, networkError }
    }

    let data: Record<string, unknown> = {}
    try {
      data = (await res.json()) as Record<string, unknown>
    } catch {
      // An HTML error page rather than JSON. The status carries the signal.
    }
    return { status: res.status, data }
  }
}
