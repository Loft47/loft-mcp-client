/**
 * The sign-in flow, end to end.
 *
 *   signIn()          register a client, mint a PKCE pair, navigate to authorize
 *   completeSignIn()  exchange the returned code for tokens
 *   refresh()         swap a refresh token for a new access token
 *
 * `completeSignIn` returns the raw token response instead of storing it. The
 * token manager needs `refresh` from here, and storing here would need the
 * token manager — returning the payload breaks that cycle and leaves the client
 * as the single place tokens are written.
 *
 * **No `scope` is sent, deliberately.** The staging discovery document
 * advertises `scopes_supported: ["public"]`, and neither the authorization
 * request nor the token exchange below includes a `scope` parameter — the
 * server grants what it grants. No option exposes one either: a `scope` option
 * is permanent public API surface, and nothing observed against this host needs
 * it. Recorded in spec §11 so the omission reads as a decision rather than an
 * oversight. Add it only when a real caller needs a narrower grant.
 */

import { challengeFor, randomVerifier } from './pkce.js'
import { classifyTokenResult } from './tokens.js'
import type { RawTokenResponse, RefreshOutcome } from './tokens.js'
import type { OAuthEndpoints, RegisteredClient } from './oauth.js'
import type { KeyStore } from './storage.js'
import type { LoftEnvironment } from './environments.js'

export interface AuthFlowOptions {
  keys: KeyStore
  oauth: OAuthEndpoints
  /** Throws `NoEnvironmentError` when nothing is selected. */
  env: () => LoftEnvironment
  appName: string
  redirectUri: string
  navigate: (url: string) => void
}

export class AuthFlow {
  private readonly keys: KeyStore
  private readonly oauth: OAuthEndpoints
  private readonly env: () => LoftEnvironment
  private readonly appName: string
  private readonly redirectUri: string
  private readonly navigate: (url: string) => void

  constructor(opts: AuthFlowOptions) {
    this.keys = opts.keys
    this.oauth = opts.oauth
    this.env = opts.env
    this.appName = opts.appName
    this.redirectUri = opts.redirectUri
    this.navigate = opts.navigate
  }

  /**
   * Registers a client and navigates away. Registration happens every time: the
   * server's registrations do not survive a redeploy, and a stale client id
   * lands the browser on a server-rendered error page this app never sees.
   */
  async signIn(): Promise<void> {
    const env = this.env()
    const [meta, client] = await Promise.all([this.oauth.meta(env), this.registerFresh(env)])

    const verifier = randomVerifier()
    const challenge = await challengeFor(verifier)
    this.keys.writeSession('pkce_verifier', verifier)

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: client.clientId,
      redirect_uri: client.redirectUri,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })

    // Absolute, unlike every `fetch` in this library: a top-level navigation is
    // not subject to CORS, and the server's session cookie belongs to that host.
    this.navigate(`${meta.authorization_endpoint}?${params}`)
  }

  async completeSignIn(code: string): Promise<RawTokenResponse> {
    const env = this.env()
    const client = await this.storedClient(env)

    const verifier = this.keys.readSession('pkce_verifier')
    if (!verifier) throw new Error('Missing PKCE verifier — restart sign-in')

    const outcome = classifyTokenResult(
      await this.oauth.postToken(env, {
        grant_type: 'authorization_code',
        code,
        client_id: client.clientId,
        redirect_uri: client.redirectUri,
        code_verifier: verifier,
      }),
    )
    // Left in place on failure so a retry is possible.
    if (!outcome.ok) throw new Error(outcome.message)

    this.keys.removeSession('pkce_verifier')
    return outcome.raw
  }

  async refresh(refreshToken: string): Promise<RefreshOutcome> {
    const env = this.env()
    const client = await this.storedClient(env)
    return classifyTokenResult(
      await this.oauth.postToken(env, {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: client.clientId,
      }),
    )
  }

  /** Registers and persists, replacing any previous registration. */
  private async registerFresh(env: LoftEnvironment): Promise<RegisteredClient> {
    const client = await this.oauth.register(env, {
      appName: this.appName,
      redirectUri: this.redirectUri,
    })
    this.keys.write('client_id', client.clientId)
    this.keys.write('redirect_uri', client.redirectUri)
    return client
  }

  /**
   * The client the authorize step used. The token exchange and the refresh must
   * present that exact id, so this never re-registers when one is stored. It
   * does register when nothing is — after a reload the refresh token survives
   * in storage and must remain usable.
   */
  private async storedClient(env: LoftEnvironment): Promise<RegisteredClient> {
    const clientId = this.keys.read('client_id')
    const redirectUri = this.keys.read('redirect_uri')
    if (clientId && redirectUri) return { clientId, redirectUri }
    return this.registerFresh(env)
  }
}
