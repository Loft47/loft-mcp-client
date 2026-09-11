/**
 * The access token's whole life: where its expiry comes from, when it is
 * renewed, what happens when renewal fails, and how two tabs avoid fighting
 * over it.
 *
 * Three triggers keep a token fresh, because none is sufficient alone:
 *
 *  1. A timer at `expiresAt - skew`. Background tabs have their timers
 *     throttled or suspended, so this fires late or not until refocus — it is an
 *     optimisation, not a guarantee.
 *  2. `ensureFresh()`, called before every request. This is the guarantee.
 *  3. A 401 from the server, handled in `transport.ts`, covering clock skew and
 *     revocation.
 *
 * Refresh is single-flight. Six concurrent requests can meet an expired token
 * at once; six parallel refreshes against a server that rotates refresh tokens
 * means five present a token the first already invalidated, and the session
 * dies. Every caller awaits one promise.
 */

import { AuthExpiredError } from './errors.js'
import type { KeyStore } from './storage.js'
import type { TokenEndpointResult } from './oauth.js'

export interface RawTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  [key: string]: unknown
}

export type RefreshOutcome =
  | { ok: true; raw: RawTokenResponse }
  /** `transient` decides whether the session survives. See spec §6. */
  | { ok: false; transient: boolean; message: string }

// ── Expiry ────────────────────────────────────────────────────────────────────

/** The `exp` claim in epoch milliseconds, or null if the token is opaque. */
export function jwtExp(token: string): number | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = parts[1]!.replace(/-/g, '+').replace(/_/g, '/')
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4)
    const claims = JSON.parse(atob(padded)) as { exp?: unknown }
    if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) return null
    return claims.exp * 1000
  } catch {
    return null
  }
}

/**
 * Best source first: what the server said, then what the token itself claims,
 * then the configured default. An expired `exp` is honoured rather than masked —
 * refreshing is the right response to a token the server would reject anyway.
 */
export function deriveExpiresAt(
  raw: RawTokenResponse,
  opts: { defaultTtlSeconds: number; now: number },
): number {
  if (typeof raw.expires_in === 'number' && Number.isFinite(raw.expires_in) && raw.expires_in > 0) {
    return opts.now + raw.expires_in * 1000
  }
  const exp = jwtExp(raw.access_token)
  if (exp !== null) return exp
  return opts.now + opts.defaultTtlSeconds * 1000
}

// ── Failure classification ────────────────────────────────────────────────────

/**
 * Decides whether a token-endpoint response ends the session. Getting this
 * wrong in either direction is bad: treating a network blip as permanent signs
 * people out for no reason, and treating a revoked grant as transient retries
 * forever.
 */
export function classifyTokenResult(result: TokenEndpointResult): RefreshOutcome {
  if (result.networkError !== undefined) {
    return { ok: false, transient: true, message: 'Network error contacting the token endpoint' }
  }
  if (result.status === 0 || result.status === 429 || result.status >= 500) {
    return { ok: false, transient: true, message: `Token endpoint returned ${result.status}` }
  }

  const accessToken = result.data.access_token
  if (result.status >= 200 && result.status < 300 && typeof accessToken === 'string' && accessToken) {
    return { ok: true, raw: result.data as unknown as RawTokenResponse }
  }

  const { error, error_description: description } = result.data
  const message =
    typeof description === 'string'
      ? description
      : typeof error === 'string'
        ? error
        : `Token endpoint returned ${result.status}`
  return { ok: false, transient: false, message }
}

// ── Manager ───────────────────────────────────────────────────────────────────

export interface TokenManagerOptions {
  keys: KeyStore
  defaultTtlSeconds: number
  skewSeconds: number
  refresh: (refreshToken: string) => Promise<RefreshOutcome>
  /** Called once when credentials are permanently gone. */
  onExpired: () => void
  onRenewed?: (accessToken: string) => void
  now?: () => number
}

export class TokenManager {
  private readonly keys: KeyStore
  private readonly defaultTtlSeconds: number
  private readonly skewMs: number
  private readonly doRefreshCall: (refreshToken: string) => Promise<RefreshOutcome>
  private readonly onExpired: () => void
  private readonly onRenewed: (accessToken: string) => void
  private readonly now: () => number

  private timer: ReturnType<typeof setTimeout> | null = null
  private refreshInFlight: Promise<string> | null = null
  private detachStorage: (() => void) | null = null

  constructor(opts: TokenManagerOptions) {
    this.keys = opts.keys
    this.defaultTtlSeconds = opts.defaultTtlSeconds
    this.skewMs = opts.skewSeconds * 1000
    this.doRefreshCall = opts.refresh
    this.onExpired = opts.onExpired
    this.onRenewed = opts.onRenewed ?? (() => {})
    this.now = opts.now ?? (() => Date.now())

    // A manager can be constructed over a token a previous page load already
    // stored (or another tab wrote). Without arming here, the renewal timer
    // would stay dead until the next `store()` — silently, since nothing about
    // a dead timer looks wrong until a session outlives it.
    this.arm()
  }

  get accessToken(): string | null {
    return this.keys.read('token')
  }

  get refreshToken(): string | null {
    return this.keys.read('refresh_token')
  }

  get expiresAt(): number | null {
    const raw = this.keys.read('expires_at')
    if (raw === null) return null
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
  }

  get isAuthenticated(): boolean {
    return this.accessToken !== null
  }

  /** False when the expiry is unknown: let a 401 decide rather than guessing. */
  isStale(): boolean {
    const expiresAt = this.expiresAt
    if (expiresAt === null) return false
    return this.now() >= expiresAt - this.skewMs
  }

  store(raw: RawTokenResponse): void {
    const expiresAt = deriveExpiresAt(raw, {
      defaultTtlSeconds: this.defaultTtlSeconds,
      now: this.now(),
    })
    this.keys.write('token', raw.access_token)
    if (typeof raw.refresh_token === 'string' && raw.refresh_token) {
      this.keys.write('refresh_token', raw.refresh_token)
    }
    this.keys.write('expires_at', String(expiresAt))
    this.arm()
  }

  /** Removes only the token triple. Identity and session are the client's job. */
  clear(): void {
    this.disarm()
    this.keys.remove('token')
    this.keys.remove('refresh_token')
    this.keys.remove('expires_at')
  }

  /** Re-arms the renewal timer against whatever is currently stored. */
  rearm(): void {
    this.arm()
  }

  async ensureFresh(): Promise<string> {
    const token = this.accessToken
    if (token === null) throw new AuthExpiredError('No access token')
    if (!this.isStale()) return token
    return this.refreshNow()
  }

  /**
   * Renews the access token, coalescing concurrent callers onto one request.
   *
   * `knownBad` names a token the caller has proof the server rejects — a 401,
   * in practice. Without it this is "refresh if stale", and a caller holding a
   * token that is locally fresh but dead at the server (clock skew, an expiry
   * the server never told us, revocation) gets that same dead token handed
   * straight back. Passing it skips the freshness short-circuit, but only when
   * the named token is still the one stored: if another tab has replaced it
   * since, the short-circuit is exactly right and still applies.
   */
  refreshNow(knownBad?: string): Promise<string> {
    if (this.refreshInFlight) return this.refreshInFlight
    const attempt = this.performRefresh(knownBad).finally(() => {
      this.refreshInFlight = null
    })
    this.refreshInFlight = attempt
    return attempt
  }

  private async performRefresh(knownBad?: string): Promise<string> {
    const observedExpiry = this.expiresAt
    const current = this.accessToken

    // A forced refresh: the caller's own 401 proves the stored token is dead,
    // whatever the local clock and the stored expiry say. This is also the only
    // path that can renew a token of unknown expiry, since `isStale()` reports
    // an unknown expiry as not stale and no other trigger ever fires for one.
    const forced = knownBad !== undefined && current === knownBad

    // Another tab may have refreshed while this call was queued. Reads go to
    // storage first, so a fresh token is visible without any message passing.
    if (!forced && !this.isStale()) {
      if (current !== null) {
        this.arm()
        return current
      }
    }

    const refreshToken = this.refreshToken
    if (refreshToken === null) return this.giveUp('No refresh token', observedExpiry)

    const outcome = await this.doRefreshCall(refreshToken)

    if (outcome.ok) {
      this.store(outcome.raw)
      this.onRenewed(outcome.raw.access_token)
      return outcome.raw.access_token
    }

    if (outcome.transient) {
      // Keep the credentials. A blip must not end the session; `ensureFresh`
      // will try again on the next request.
      throw new Error(outcome.message)
    }

    return this.giveUp(outcome.message, observedExpiry)
  }

  /**
   * A permanent failure — unless another tab wrote a newer token while this
   * refresh was in flight, which is exactly what happens when both tabs renew
   * at once and the server rotates refresh tokens. Adopting beats signing out.
   */
  private giveUp(message: string, observedExpiry: number | null): string {
    const currentExpiry = this.expiresAt
    const token = this.accessToken
    if (
      token !== null &&
      currentExpiry !== null &&
      observedExpiry !== null &&
      currentExpiry > observedExpiry
    ) {
      this.arm()
      return token
    }

    this.clear()
    this.onExpired()
    throw new AuthExpiredError(message)
  }

  private arm(): void {
    this.disarm()
    const expiresAt = this.expiresAt
    if (expiresAt === null) return

    const delay = Math.max(0, expiresAt - this.skewMs - this.now())
    this.timer = setTimeout(() => {
      // Failures here surface through `onExpired` or on the next request; there
      // is no caller to reject.
      void this.refreshNow().catch(() => {})
    }, delay)
  }

  private disarm(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /**
   * Watches for another tab writing this environment's token, and re-arms
   * against the new expiry. Adoption itself is free — reads hit storage.
   */
  attachStorageListener(target: EventTarget = window): () => void {
    const handler = (event: Event) => {
      let tokenKey: string
      try {
        tokenKey = this.keys.key('token')
      } catch {
        return // No environment selected; nothing to adopt.
      }
      const key = (event as StorageEvent).key
      // A null key means storage was cleared wholesale, which also concerns us.
      if (key !== null && key !== tokenKey) return
      this.arm()
    }
    target.addEventListener('storage', handler)
    this.detachStorage = () => target.removeEventListener('storage', handler)
    return this.detachStorage
  }

  dispose(): void {
    this.disarm()
    this.detachStorage?.()
    this.detachStorage = null
  }
}
