/**
 * Who is signed in.
 *
 * The only trustworthy source is the token itself: `GetUserinfo` returns the
 * claims of whoever holds it. Nothing here is user-editable, so an action
 * cannot be attributed to someone else's name.
 *
 * Cached two ways deliberately. The in-memory copy makes `current` synchronous,
 * which callers need when stamping an actor inside a plain event handler. The
 * persisted copy is environment-scoped and survives a reload, so the first
 * action after a refresh does not race the round trip.
 */

import { attrs } from './jsonapi.js'
import type { Doc } from './jsonapi.js'
import type { KeyStore } from './storage.js'

export interface Identity {
  /** The user id as a string — OIDC's subject identifier. */
  sub: string
  /** Always non-empty: the name, else the email, else `User <sub>`. */
  name: string
  email: string | null
  profileId: number | null
  /** Agent, Broker, OfficeAdmin, SuperAdmin, … */
  profileType: string | null
}

export interface UserinfoAttrs {
  sub: string
  name: string | null
  email: string | null
  profileId: number | null
  profileType: string | null
}

export interface IdentityStoreOptions {
  keys: KeyStore
  call: <T>(name: string, args?: Record<string, unknown>) => Promise<T>
}

export class IdentityStore {
  private readonly keys: KeyStore
  private readonly call: <T>(name: string, args?: Record<string, unknown>) => Promise<T>
  /** Keyed by storage key, so switching environment cannot leak an identity. */
  private cached: { key: string; identity: Identity } | null = null

  constructor(opts: IdentityStoreOptions) {
    this.keys = opts.keys
    this.call = opts.call
  }

  get current(): Identity | null {
    let key: string
    try {
      key = this.keys.key('identity')
    } catch {
      return null // No environment; nothing can be attributed anyway.
    }
    if (this.cached?.key === key) return this.cached.identity

    const stored = this.keys.readJson<Identity | null>('identity', null)
    if (!stored?.sub || !stored?.name) return null

    this.cached = { key, identity: stored }
    return stored
  }

  async load(): Promise<Identity> {
    const known = this.current
    if (known) return known

    const claims = attrs<UserinfoAttrs>(await this.call<Doc<UserinfoAttrs>>('GetUserinfo'))
    if (!claims?.sub) throw new Error('GetUserinfo returned no subject claim')

    const identity: Identity = {
      sub: claims.sub,
      name: claims.name || claims.email || `User ${claims.sub}`,
      email: claims.email ?? null,
      profileId: claims.profileId ?? null,
      profileType: claims.profileType ?? null,
    }

    this.cached = { key: this.keys.key('identity'), identity }
    this.keys.writeJson('identity', identity)
    return identity
  }

  clear(): void {
    this.cached = null
    try {
      this.keys.remove('identity')
    } catch {
      // No environment selected; nothing stored.
    }
  }
}
