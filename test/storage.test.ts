import { beforeEach, describe, expect, it, vi } from 'vitest'
import { KeyStore, LIBRARY_KEY_NAMES } from '../src/storage.js'
import { NoEnvironmentError } from '../src/errors.js'
import { fakeStorage } from './helpers/fakeStorage.js'
import type { FakeStorage } from './helpers/fakeStorage.js'

let storage: FakeStorage
let session: FakeStorage
let keys: KeyStore

beforeEach(() => {
  storage = fakeStorage()
  session = fakeStorage()
  keys = new KeyStore({ prefix: 'commission_audit', storage, session })
})

describe('environment selection', () => {
  it('starts with no environment', () => {
    expect(keys.environmentId).toBeNull()
  })

  it('persists the choice under an un-namespaced key', () => {
    keys.setEnvironmentId('staging')
    expect(keys.environmentId).toBe('staging')
    expect(storage.dump()['commission_audit:environment']).toBe('staging')
  })

  it('clears the choice', () => {
    keys.setEnvironmentId('staging')
    keys.clearEnvironmentId()
    expect(keys.environmentId).toBeNull()
  })
})

describe('key namespacing', () => {
  beforeEach(() => keys.setEnvironmentId('staging'))

  it('namespaces by prefix and environment', () => {
    expect(keys.key('token')).toBe('commission_audit:staging:token')
  })

  it('scopes app state by brokerage', () => {
    expect(keys.brokerageKey('rules', 45)).toBe('commission_audit:staging:45:rules')
  })

  it('separates environments completely', () => {
    keys.write('token', 'staging-token')
    keys.setEnvironmentId('production')
    expect(keys.read('token')).toBeNull()
    keys.write('token', 'production-token')
    keys.setEnvironmentId('staging')
    expect(keys.read('token')).toBe('staging-token')
  })
})

describe('no environment selected', () => {
  it('throws NoEnvironmentError when building a key', () => {
    expect(() => keys.key('token')).toThrow(NoEnvironmentError)
  })

  it('throws NoEnvironmentError on write, rather than writing to an orphan namespace', () => {
    expect(() => keys.write('token', 'x')).toThrow(NoEnvironmentError)
    expect(Object.keys(storage.dump())).not.toContain('commission_audit:unset:token')
    expect(storage.length).toBe(0)
  })

  it('returns null on read instead of throwing', () => {
    expect(keys.read('token')).toBeNull()
    expect(keys.readJson('identity', null)).toBeNull()
  })
})

describe('JSON round-trip', () => {
  beforeEach(() => keys.setEnvironmentId('staging'))

  it('reads back what it wrote', () => {
    keys.writeJson('identity', { sub: '7', name: 'Dana' })
    expect(keys.readJson('identity', null)).toEqual({ sub: '7', name: 'Dana' })
  })

  it('falls back when the value is corrupt rather than throwing', () => {
    storage.seed('commission_audit:staging:identity', '{ not json')
    expect(keys.readJson('identity', { sub: '0' })).toEqual({ sub: '0' })
  })

  it('falls back when the key is absent', () => {
    expect(keys.readJson('identity', 'fallback')).toBe('fallback')
  })
})

describe('memory mirror when storage is unwritable', () => {
  it('reports the error and still serves the value for this session', () => {
    const onStorageError = vi.fn()
    const failing = fakeStorage({ failWrites: true })
    const store = new KeyStore({
      prefix: 'commission_audit',
      storage: failing,
      session,
      onStorageError,
    })
    // The environment write fails too, so seed it directly to reach the token path.
    failing.failWrites = false
    store.setEnvironmentId('staging')
    failing.failWrites = true

    store.write('token', 'abc')

    expect(onStorageError).toHaveBeenCalledOnce()
    expect(store.read('token')).toBe('abc')
    expect(failing.dump()['commission_audit:staging:token']).toBeUndefined()
  })

  it('forgets a value once it is removed', () => {
    keys.setEnvironmentId('staging')
    keys.write('token', 'abc')
    keys.remove('token')
    expect(keys.read('token')).toBeNull()
  })
})

describe('sessionStorage keys', () => {
  it('keeps the PKCE verifier out of localStorage', () => {
    keys.setEnvironmentId('staging')
    keys.writeSession('pkce_verifier', 'v')
    expect(session.dump()['commission_audit:staging:pkce_verifier']).toBe('v')
    expect(storage.dump()['commission_audit:staging:pkce_verifier']).toBeUndefined()
    expect(keys.readSession('pkce_verifier')).toBe('v')
    keys.removeSession('pkce_verifier')
    expect(keys.readSession('pkce_verifier')).toBeNull()
  })
})

describe('revocation — spec §7 three-tier table', () => {
  const APP_KEYS = [
    'commission_audit:staging:45:resolutions',
    'commission_audit:staging:45:log',
    'commission_audit:staging:45:signoff:2026-08',
    'commission_audit:staging:45:rules',
  ]

  beforeEach(() => {
    keys.setEnvironmentId('staging')
    for (const name of LIBRARY_KEY_NAMES) keys.write(name, `value-of-${name}`)
    for (const key of APP_KEYS) storage.seed(key, '["app data"]')
    storage.seed('commission_audit:unset:token', 'orphan from the old code')
    storage.seed('other_app:staging:token', 'a different app on this origin')
  })

  it('clearLibraryKeys removes every enumerated library key', () => {
    keys.clearLibraryKeys()
    for (const name of LIBRARY_KEY_NAMES) {
      expect(storage.dump()[`commission_audit:staging:${name}`]).toBeUndefined()
    }
  })

  it('clearLibraryKeys leaves app state intact', () => {
    keys.clearLibraryKeys()
    for (const key of APP_KEYS) expect(storage.dump()[key]).toBe('["app data"]')
  })

  it('clearLibraryKeys leaves the environment choice intact', () => {
    keys.clearLibraryKeys()
    expect(keys.environmentId).toBe('staging')
  })

  it('purge removes app state as well', () => {
    keys.purge()
    for (const key of APP_KEYS) expect(storage.dump()[key]).toBeUndefined()
  })

  it('purge removes the environment choice', () => {
    keys.purge()
    expect(keys.environmentId).toBeNull()
  })

  it('purge sweeps :unset: orphans left by earlier code', () => {
    keys.purge()
    expect(storage.dump()['commission_audit:unset:token']).toBeUndefined()
  })

  it('purge never touches another prefix on the same origin', () => {
    keys.purge()
    expect(storage.dump()['other_app:staging:token']).toBe('a different app on this origin')
  })

  it('purge clears sessionStorage too', () => {
    keys.writeSession('pkce_verifier', 'v')
    keys.purge()
    expect(session.dump()['commission_audit:staging:pkce_verifier']).toBeUndefined()
  })

  it('purge does not depend on an environment being selected', () => {
    keys.clearEnvironmentId()
    expect(() => keys.purge()).not.toThrow()
    expect(storage.dump()['commission_audit:staging:45:log']).toBeUndefined()
  })
})

describe('an overwrite whose mirror write fails — Finding I4', () => {
  // The case above only covers a key that was never in storage, where
  // `getItem` returns null and the memory fallback is reached anyway. The
  // dangerous case is an *overwrite*: storage keeps the previous value and,
  // under a storage-first read, the new one in memory is never seen. For a
  // token that means every request re-presents the dead one and re-POSTs the
  // token endpoint with a refresh token the server may already have rotated.
  let failing: FakeStorage
  let onStorageError: ReturnType<typeof vi.fn>
  let store: KeyStore

  beforeEach(() => {
    failing = fakeStorage()
    onStorageError = vi.fn()
    store = new KeyStore({ prefix: 'commission_audit', storage: failing, session, onStorageError })
    store.setEnvironmentId('staging')
    store.write('token', 'first')
    expect(failing.dump()['commission_audit:staging:token']).toBe('first')
  })

  it('serves the new value, not the stale one still sitting in storage', () => {
    failing.failWrites = true
    store.write('token', 'second')

    expect(onStorageError).toHaveBeenCalledOnce()
    expect(failing.dump()['commission_audit:staging:token']).toBe('first')
    expect(store.read('token')).toBe('second')
  })

  it('keeps serving it across several failed renewals', () => {
    failing.failWrites = true
    store.write('token', 'second')
    store.write('token', 'third')
    expect(store.read('token')).toBe('third')
  })

  it('goes back to storage once a write succeeds again', () => {
    failing.failWrites = true
    store.write('token', 'second')
    failing.failWrites = false
    store.write('token', 'third')

    expect(failing.dump()['commission_audit:staging:token']).toBe('third')
    failing.seed('commission_audit:staging:token', 'from-another-tab')
    expect(store.read('token')).toBe('from-another-tab')
  })

  it('goes back to storage when another tab writes the key', () => {
    const target = new EventTarget()
    const detach = store.attachStorageListener(target)
    failing.failWrites = true
    store.write('token', 'second')
    expect(store.read('token')).toBe('second')

    failing.failWrites = false
    failing.seed('commission_audit:staging:token', 'from-another-tab')
    const event = new Event('storage') as Event & { key: string | null }
    event.key = 'commission_audit:staging:token'
    target.dispatchEvent(event)

    expect(store.read('token')).toBe('from-another-tab')
    detach()
  })

  it('drops every flag when a storage event reports a wholesale clear', () => {
    const target = new EventTarget()
    store.attachStorageListener(target)
    failing.failWrites = true
    store.write('token', 'second')

    failing.failWrites = false
    failing.seed('commission_audit:staging:token', 'rewritten elsewhere')
    const event = new Event('storage') as Event & { key: string | null }
    event.key = null
    target.dispatchEvent(event)

    expect(store.read('token')).toBe('rewritten elsewhere')
  })

  it('does not shadow a different key that mirrored fine', () => {
    store.write('refresh_token', 'rt')
    failing.failWrites = true
    store.write('token', 'second')
    failing.failWrites = false

    failing.seed('commission_audit:staging:refresh_token', 'rt-from-another-tab')
    expect(store.read('refresh_token')).toBe('rt-from-another-tab')
    expect(store.read('token')).toBe('second')
  })
})
