import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KeyStore } from '../src/storage.js'
import { AuthExpiredError } from '../src/errors.js'
import { classifyTokenResult, deriveExpiresAt, jwtExp, TokenManager } from '../src/tokens.js'
import type { RawTokenResponse, RefreshOutcome } from '../src/tokens.js'
import { fakeStorage } from './helpers/fakeStorage.js'
import type { FakeStorage } from './helpers/fakeStorage.js'

/** Builds an unsigned JWT with the given `exp` in epoch seconds. */
function jwtWithExp(expSeconds: number): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  return `${b64({ alg: 'none' })}.${b64({ sub: '7', exp: expSeconds })}.sig`
}

describe('jwtExp', () => {
  it('reads exp and converts seconds to milliseconds', () => {
    expect(jwtExp(jwtWithExp(1_800_000_000))).toBe(1_800_000_000_000)
  })
  it('returns null for an opaque token', () => expect(jwtExp('not-a-jwt')).toBeNull())
  it('returns null when the payload is not base64', () => expect(jwtExp('a.!!!.c')).toBeNull())
  it('returns null when there is no exp claim', () => {
    const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, '')
    expect(jwtExp(`${b64({})}.${b64({ sub: '7' })}.sig`)).toBeNull()
  })
  it('returns null when exp is not a number', () => {
    const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, '')
    expect(jwtExp(`${b64({})}.${b64({ exp: 'soon' })}.sig`)).toBeNull()
  })
})

describe('deriveExpiresAt — spec §6 fallback chain', () => {
  const now = 1_700_000_000_000

  it('prefers expires_in from the token response', () => {
    const raw: RawTokenResponse = { access_token: 'opaque', expires_in: 1800 }
    expect(deriveExpiresAt(raw, { defaultTtlSeconds: 60, now })).toBe(now + 1_800_000)
  })

  it("falls back to the access token's exp claim when expires_in is absent", () => {
    const raw: RawTokenResponse = { access_token: jwtWithExp(1_700_000_900) }
    expect(deriveExpiresAt(raw, { defaultTtlSeconds: 60, now })).toBe(1_700_000_900_000)
  })

  it('falls back to the configured default when there is neither', () => {
    const raw: RawTokenResponse = { access_token: 'opaque' }
    expect(deriveExpiresAt(raw, { defaultTtlSeconds: 1800, now })).toBe(now + 1_800_000)
  })

  it('ignores a zero or negative expires_in and uses the next source', () => {
    expect(deriveExpiresAt({ access_token: 'o', expires_in: 0 }, { defaultTtlSeconds: 60, now }))
      .toBe(now + 60_000)
    expect(deriveExpiresAt({ access_token: 'o', expires_in: -5 }, { defaultTtlSeconds: 60, now }))
      .toBe(now + 60_000)
  })

  it('honours an already-expired exp claim rather than masking it', () => {
    // Trusting the token is correct: the next call refreshes instead of
    // presenting something the server will reject.
    const raw: RawTokenResponse = { access_token: jwtWithExp(1_699_999_000) }
    expect(deriveExpiresAt(raw, { defaultTtlSeconds: 1800, now })).toBe(1_699_999_000_000)
  })
})

describe('classifyTokenResult — spec §6 failure table', () => {
  it('accepts a 200 carrying an access token', () => {
    const outcome = classifyTokenResult({ status: 200, data: { access_token: 'at' } })
    expect(outcome).toEqual({ ok: true, raw: { access_token: 'at' } })
  })

  it('treats a network error as transient', () => {
    const outcome = classifyTokenResult({ status: 0, data: {}, networkError: new TypeError('x') })
    expect(outcome).toMatchObject({ ok: false, transient: true })
  })

  it('treats 5xx as transient', () => {
    expect(classifyTokenResult({ status: 503, data: {} })).toMatchObject({ transient: true })
  })

  it('treats 429 as transient', () => {
    expect(classifyTokenResult({ status: 429, data: {} })).toMatchObject({ transient: true })
  })

  it('treats invalid_grant as permanent and keeps its description', () => {
    const outcome = classifyTokenResult({
      status: 400,
      data: { error: 'invalid_grant', error_description: 'Refresh token revoked' },
    })
    expect(outcome).toEqual({ ok: false, transient: false, message: 'Refresh token revoked' })
  })

  it('treats any other 4xx as permanent', () => {
    expect(classifyTokenResult({ status: 401, data: { error: 'invalid_client' } }))
      .toMatchObject({ ok: false, transient: false, message: 'invalid_client' })
  })

  it('treats a 200 without an access token as permanent', () => {
    expect(classifyTokenResult({ status: 200, data: {} }))
      .toMatchObject({ ok: false, transient: false })
  })
})

// ── TokenManager ──────────────────────────────────────────────────────────────

const SKEW = 120
const NOW = 1_700_000_000_000

let storage: FakeStorage
let keys: KeyStore
let refresh: ReturnType<typeof vi.fn>
let onExpired: ReturnType<typeof vi.fn>
let manager: TokenManager

function build(overrides: Partial<{ defaultTtlSeconds: number }> = {}): TokenManager {
  return new TokenManager({
    keys,
    defaultTtlSeconds: overrides.defaultTtlSeconds ?? 1800,
    skewSeconds: SKEW,
    refresh: refresh as unknown as (rt: string) => Promise<RefreshOutcome>,
    onExpired,
    now: () => Date.now(),
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  storage = fakeStorage()
  keys = new KeyStore({ prefix: 'app', storage, session: fakeStorage() })
  keys.setEnvironmentId('staging')
  refresh = vi.fn()
  onExpired = vi.fn()
  manager = build()
})

afterEach(() => {
  manager.dispose()
  vi.useRealTimers()
})

describe('store', () => {
  it('persists the token, refresh token and derived expiry', () => {
    manager.store({ access_token: 'at', refresh_token: 'rt', expires_in: 1800 })
    expect(keys.read('token')).toBe('at')
    expect(keys.read('refresh_token')).toBe('rt')
    expect(keys.read('expires_at')).toBe(String(NOW + 1_800_000))
  })

  it('keeps the existing refresh token when the response omits one', () => {
    manager.store({ access_token: 'at1', refresh_token: 'rt1', expires_in: 1800 })
    manager.store({ access_token: 'at2', expires_in: 1800 })
    expect(keys.read('refresh_token')).toBe('rt1')
  })

  it('replaces a rotated refresh token', () => {
    manager.store({ access_token: 'at1', refresh_token: 'rt1', expires_in: 1800 })
    manager.store({ access_token: 'at2', refresh_token: 'rt2', expires_in: 1800 })
    expect(keys.read('refresh_token')).toBe('rt2')
  })
})

describe('isStale', () => {
  it('is false well before expiry', () => {
    manager.store({ access_token: 'at', expires_in: 1800 })
    expect(manager.isStale()).toBe(false)
  })

  it('is true inside the skew window', () => {
    manager.store({ access_token: 'at', expires_in: 1800 })
    vi.setSystemTime(NOW + 1_800_000 - SKEW * 1000 + 1)
    expect(manager.isStale()).toBe(true)
  })

  it('is false with no stored expiry, leaving the 401 path to handle it', () => {
    keys.write('token', 'at')
    expect(manager.isStale()).toBe(false)
  })
})

describe('ensureFresh', () => {
  it('returns the current token when it is not stale, without refreshing', async () => {
    manager.store({ access_token: 'at', refresh_token: 'rt', expires_in: 1800 })
    await expect(manager.ensureFresh()).resolves.toBe('at')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('refreshes inside the skew window and returns the new token', async () => {
    manager.store({ access_token: 'old', refresh_token: 'rt', expires_in: 1800 })
    refresh.mockResolvedValue({ ok: true, raw: { access_token: 'new', expires_in: 1800 } })
    vi.setSystemTime(NOW + 1_800_000 - 60_000)

    await expect(manager.ensureFresh()).resolves.toBe('new')
    expect(refresh).toHaveBeenCalledWith('rt')
    expect(keys.read('token')).toBe('new')
  })

  it('throws AuthExpiredError when there is no token at all', async () => {
    await expect(manager.ensureFresh()).rejects.toThrow(AuthExpiredError)
  })
})

describe('single-flight refresh — the bug this library exists to fix', () => {
  it('collapses six concurrent stale callers into one refresh POST', async () => {
    manager.store({ access_token: 'old', refresh_token: 'rt', expires_in: 1800 })
    vi.setSystemTime(NOW + 1_800_000 - 60_000)

    let release: (v: RefreshOutcome) => void = () => {}
    refresh.mockImplementation(() => new Promise<RefreshOutcome>((r) => { release = r }))

    const callers = Array.from({ length: 6 }, () => manager.ensureFresh())
    release({ ok: true, raw: { access_token: 'new', expires_in: 1800 } })

    await expect(Promise.all(callers)).resolves.toEqual(Array(6).fill('new'))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('allows a later refresh once the first has settled', async () => {
    manager.store({ access_token: 'old', refresh_token: 'rt', expires_in: 1800 })
    refresh.mockResolvedValue({ ok: true, raw: { access_token: 'new', expires_in: 1 } })
    vi.setSystemTime(NOW + 1_800_000 - 60_000)

    await manager.refreshNow()
    refresh.mockResolvedValue({ ok: true, raw: { access_token: 'newer', expires_in: 1800 } })
    await expect(manager.refreshNow()).resolves.toBe('newer')
    expect(refresh).toHaveBeenCalledTimes(2)
  })
})

describe('renewal timer', () => {
  it('arms at expiry minus skew', async () => {
    manager.store({ access_token: 'old', refresh_token: 'rt', expires_in: 1800 })
    refresh.mockResolvedValue({ ok: true, raw: { access_token: 'new', expires_in: 1800 } })

    await vi.advanceTimersByTimeAsync(1_800_000 - SKEW * 1000 - 1)
    expect(refresh).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('re-arms after each renewal, so a long session keeps renewing', async () => {
    manager.store({ access_token: 't0', refresh_token: 'rt', expires_in: 1800 })
    refresh.mockResolvedValue({ ok: true, raw: { access_token: 't1', refresh_token: 'rt', expires_in: 1800 } })

    await vi.advanceTimersByTimeAsync(1_800_000 - SKEW * 1000)
    expect(refresh).toHaveBeenCalledTimes(1)

    refresh.mockResolvedValue({ ok: true, raw: { access_token: 't2', refresh_token: 'rt', expires_in: 1800 } })
    await vi.advanceTimersByTimeAsync(1_800_000 - SKEW * 1000)
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(keys.read('token')).toBe('t2')
  })

  // The brief's original version of this case constructed a client, attached a
  // storage listener to a throwaway EventTarget, then called refreshNow()
  // directly — which never touches the timer at all. What it should assert is
  // that arm() clamps a negative delay to 0 instead of computing a nonsensical
  // setTimeout value: a TokenManager constructed over a token already inside
  // the skew window must have its timer fire on the very next tick, with no
  // time advance needed beyond flushing the clamped (zero-delay) timer.
  it('fires immediately when the stored token is already inside the window', async () => {
    keys.write('token', 'at')
    keys.write('refresh_token', 'rt')
    keys.write('expires_at', String(NOW + 1000)) // inside the 120s skew window
    refresh.mockResolvedValue({ ok: true, raw: { access_token: 'new', expires_in: 1800 } })

    const revived = build()
    try {
      // No time advance beyond flushing a zero-delay timer: arm() must have
      // clamped `expiresAt - skew - now` (a negative number here) to 0 rather
      // than scheduling something that never fires or fires absurdly late.
      await vi.advanceTimersByTimeAsync(0)
      expect(refresh).toHaveBeenCalledTimes(1)
      expect(keys.read('token')).toBe('new')
    } finally {
      revived.dispose()
    }
  })

  it('stops firing after dispose', async () => {
    manager.store({ access_token: 'at', refresh_token: 'rt', expires_in: 1800 })
    manager.dispose()
    await vi.advanceTimersByTimeAsync(1_800_000)
    expect(refresh).not.toHaveBeenCalled()
  })

  // Correction 2: `rearm()` exists so a caller who wrote (or adopted) an expiry
  // without going through `store()` — e.g. a client switching into an
  // environment that already had a token in storage from a prior session —
  // can still get the proactive-renewal timer armed.
  it('rearm() arms the timer against a stored expiry the manager did not itself write', async () => {
    // Written directly to storage, bypassing store() entirely, so the manager
    // has no way to know about this expiry except by reading it back.
    keys.write('token', 'at')
    keys.write('refresh_token', 'rt')
    keys.write('expires_at', String(NOW + 1_800_000))
    refresh.mockResolvedValue({ ok: true, raw: { access_token: 'new', expires_in: 1800 } })

    manager.rearm()

    await vi.advanceTimersByTimeAsync(1_800_000 - SKEW * 1000 - 1)
    expect(refresh).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(keys.read('token')).toBe('new')
  })
})

describe('refresh failure — spec §6 table', () => {
  beforeEach(() => {
    manager.store({ access_token: 'old', refresh_token: 'rt', expires_in: 1800 })
    keys.writeJson('identity', { sub: '7' })
    keys.write('brokerage_id', '45')
    vi.setSystemTime(NOW + 1_800_000 - 60_000)
  })

  it('permanent: drops credentials, notifies, and throws AuthExpiredError', async () => {
    refresh.mockResolvedValue({ ok: false, transient: false, message: 'Refresh token revoked' })

    await expect(manager.ensureFresh()).rejects.toThrow(AuthExpiredError)
    expect(keys.read('token')).toBeNull()
    expect(keys.read('refresh_token')).toBeNull()
    expect(keys.read('expires_at')).toBeNull()
    expect(onExpired).toHaveBeenCalledOnce()
  })

  it('permanent: leaves the environment and brokerage default in place', async () => {
    refresh.mockResolvedValue({ ok: false, transient: false, message: 'nope' })
    await expect(manager.ensureFresh()).rejects.toThrow(AuthExpiredError)
    expect(keys.environmentId).toBe('staging')
    expect(keys.read('brokerage_id')).toBe('45')
  })

  it('permanent: throws AuthExpiredError when there is no refresh token', async () => {
    keys.remove('refresh_token')
    await expect(manager.ensureFresh()).rejects.toThrow(AuthExpiredError)
    expect(refresh).not.toHaveBeenCalled()
    expect(onExpired).toHaveBeenCalledOnce()
  })

  it('transient: keeps every credential and does not notify', async () => {
    refresh.mockResolvedValue({ ok: false, transient: true, message: 'Token endpoint returned 503' })

    await expect(manager.ensureFresh()).rejects.toThrow('503')
    await expect(manager.ensureFresh()).rejects.not.toThrow(AuthExpiredError)
    expect(keys.read('token')).toBe('old')
    expect(keys.read('refresh_token')).toBe('rt')
    expect(onExpired).not.toHaveBeenCalled()
  })

  it('transient: a later attempt can still succeed', async () => {
    refresh.mockResolvedValueOnce({ ok: false, transient: true, message: 'offline' })
    await expect(manager.ensureFresh()).rejects.toThrow('offline')

    refresh.mockResolvedValue({ ok: true, raw: { access_token: 'new', expires_in: 1800 } })
    await expect(manager.ensureFresh()).resolves.toBe('new')
  })
})

describe('multi-tab', () => {
  it('short-circuits when another tab refreshed while this one was queued', async () => {
    // Fresh, not stale — ensureFresh() would never even call refreshNow()
    // here, so calling refreshNow() directly is what actually reaches
    // performRefresh(). That's the point: a caller can enter performRefresh()
    // after the token underneath it has already changed — because it was
    // queued behind another tab's in-flight refresh — and performRefresh()'s
    // own isStale() re-check must hand back the current token without ever
    // invoking the refresh callback. Deleting that re-check falls through to
    // calling `refresh` unconditionally, which fails the second assertion.
    manager.store({ access_token: 'fresh', refresh_token: 'rt', expires_in: 1800 })

    await expect(manager.refreshNow()).resolves.toBe('fresh')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('adopts a newer token rather than signing out when its own refresh is rejected', async () => {
    manager.store({ access_token: 'old', refresh_token: 'stale-rt', expires_in: 1800 })
    vi.setSystemTime(NOW + 1_800_000 - 60_000)

    // The other tab rotated the refresh token first, so ours is now invalid —
    // but a usable token exists. Signing out here would be the wrong outcome.
    refresh.mockImplementation(async () => {
      storage.seed('app:staging:token', 'from-other-tab')
      storage.seed('app:staging:expires_at', String(Date.now() + 1_800_000))
      return { ok: false, transient: false, message: 'invalid_grant' }
    })

    await expect(manager.ensureFresh()).resolves.toBe('from-other-tab')
    expect(onExpired).not.toHaveBeenCalled()
    expect(keys.read('token')).toBe('from-other-tab')
  })

  it('re-arms its timer when a storage event announces a new token', async () => {
    manager.store({ access_token: 'at', refresh_token: 'rt', expires_in: 1800 })
    const target = new EventTarget()
    const detach = manager.attachStorageListener(target)

    storage.seed('app:staging:expires_at', String(Date.now() + 60_000))
    const event = new Event('storage') as Event & { key: string }
    Object.defineProperty(event, 'key', { value: 'app:staging:token' })
    target.dispatchEvent(event)

    refresh.mockResolvedValue({ ok: true, raw: { access_token: 'new', expires_in: 1800 } })
    // The announced expiry (60s) is already inside the 120s skew window, so
    // arm() clamps the delay to 0 rather than computing a negative one — the
    // brief's literal `60_000 - SKEW * 1000 + 1` is negative here and vitest's
    // fake timers reject a negative advance outright, so it is clamped the
    // same way arm() clamps its own delay.
    await vi.advanceTimersByTimeAsync(Math.max(0, 60_000 - SKEW * 1000) + 1)
    expect(refresh).toHaveBeenCalledTimes(1)
    detach()
  })

  it('ignores storage events for other keys', async () => {
    // Standing timer: ~1,680,000ms out. Too far for a 1000ms advance to
    // reach on its own — so if the wrong-key event is (wrongly) allowed to
    // re-arm, the only way to detect it is to make the re-arm itself land on
    // a near-zero delay. Mirrors the positive-control case above: seed an
    // expires_at already inside the skew window directly into storage, so a
    // spurious re-arm would clamp to ~0 and fire well within the advance.
    manager.store({ access_token: 'at', refresh_token: 'rt', expires_in: 1800 })
    const target = new EventTarget()
    manager.attachStorageListener(target)

    storage.seed('app:staging:expires_at', String(Date.now() + 1000))
    refresh.mockResolvedValue({ ok: true, raw: { access_token: 'new', expires_in: 1800 } })

    const event = new Event('storage') as Event & { key: string }
    Object.defineProperty(event, 'key', { value: 'app:staging:45:rules' })
    target.dispatchEvent(event)

    // A working filter ignores the event and leaves the original long timer
    // standing, so nothing fires in this short window — including the
    // near-zero delay a spurious re-arm against the seeded expiry would have
    // produced. A missing filter would re-arm on it and fire almost
    // immediately, failing this assertion.
    await vi.advanceTimersByTimeAsync(1000)
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('forced refresh — Finding C1', () => {
  // `refreshNow()` on its own means "refresh if stale", and the short-circuit
  // that makes it safe for the multi-tab case also makes it useless to a 401
  // handler: it hands back the very token the server just rejected. Naming the
  // known-bad token separates the two.
  it('refreshes a token that is locally fresh when the caller names it as dead', async () => {
    manager.store({ access_token: 'at', refresh_token: 'rt', expires_in: 1800 })
    refresh.mockResolvedValue({ ok: true, raw: { access_token: 'new', expires_in: 1800 } })

    expect(manager.isStale()).toBe(false)
    await expect(manager.refreshNow('at')).resolves.toBe('new')
    expect(refresh).toHaveBeenCalledWith('rt')
  })

  it('refreshes a token of unknown expiry, which no other trigger can reach', async () => {
    // isStale() reports an unknown expiry as not stale by design, so the timer
    // never arms and the pre-flight never fires. Before the forced path, such
    // a token could not be renewed by anything at all.
    keys.write('token', 'at')
    keys.write('refresh_token', 'rt')
    refresh.mockResolvedValue({ ok: true, raw: { access_token: 'new', expires_in: 1800 } })

    expect(manager.isStale()).toBe(false)
    await expect(manager.refreshNow('at')).resolves.toBe('new')
    expect(keys.read('token')).toBe('new')
  })

  it('still short-circuits when the named token is no longer the stored one', async () => {
    // Another tab refreshed while this caller was queued behind its own 401.
    // The token it names is already gone, so there is nothing to force.
    manager.store({ access_token: 'at', refresh_token: 'rt', expires_in: 1800 })
    storage.seed('app:staging:token', 'from-other-tab')

    await expect(manager.refreshNow('at')).resolves.toBe('from-other-tab')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('coalesces forced and unforced callers onto one refresh', async () => {
    manager.store({ access_token: 'at', refresh_token: 'rt', expires_in: 1800 })
    vi.setSystemTime(NOW + 1_800_000 - 60_000)

    let release: (v: RefreshOutcome) => void = () => {}
    refresh.mockImplementation(() => new Promise<RefreshOutcome>((r) => { release = r }))

    const callers = [
      manager.refreshNow('at'),
      manager.refreshNow('at'),
      manager.refreshNow(),
      manager.ensureFresh(),
    ]
    release({ ok: true, raw: { access_token: 'new', expires_in: 1800 } })

    await expect(Promise.all(callers)).resolves.toEqual(Array(4).fill('new'))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('adopts a newer token rather than signing out, even on the forced path', async () => {
    manager.store({ access_token: 'at', refresh_token: 'stale-rt', expires_in: 1800 })
    refresh.mockImplementation(async () => {
      storage.seed('app:staging:token', 'from-other-tab')
      storage.seed('app:staging:expires_at', String(Date.now() + 3_600_000))
      return { ok: false, transient: false, message: 'invalid_grant' }
    })

    await expect(manager.refreshNow('at')).resolves.toBe('from-other-tab')
    expect(onExpired).not.toHaveBeenCalled()
  })
})
