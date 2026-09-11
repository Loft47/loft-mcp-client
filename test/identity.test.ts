import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IdentityStore } from '../src/identity'
import { KeyStore } from '../src/storage'
import { fakeStorage } from './helpers/fakeStorage'
import type { FakeStorage } from './helpers/fakeStorage'

const userinfo = (attributes: Record<string, unknown>) => ({
  data: { id: '7', type: 'userinfo', attributes },
})

let storage: FakeStorage
let keys: KeyStore
let call: ReturnType<typeof vi.fn>
let identity: IdentityStore

beforeEach(() => {
  storage = fakeStorage()
  keys = new KeyStore({ prefix: 'app', storage, session: fakeStorage() })
  keys.setEnvironmentId('staging')
  call = vi.fn()
  identity = new IdentityStore({ keys, call: call as never })
})

describe('load', () => {
  it('maps the claims and calls GetUserinfo with no arguments', async () => {
    call.mockResolvedValue(
      userinfo({ sub: '7', name: 'Dana Reyes', email: 'dana@x.com', profileId: 12, profileType: 'Broker' }),
    )
    await expect(identity.load()).resolves.toEqual({
      sub: '7',
      name: 'Dana Reyes',
      email: 'dana@x.com',
      profileId: 12,
      profileType: 'Broker',
    })
    expect(call).toHaveBeenCalledWith('GetUserinfo')
  })

  it('falls back to the email when there is no name', async () => {
    call.mockResolvedValue(userinfo({ sub: '7', name: null, email: 'dana@x.com' }))
    expect((await identity.load()).name).toBe('dana@x.com')
  })

  it('falls back to the subject when there is neither', async () => {
    call.mockResolvedValue(userinfo({ sub: '7', name: null, email: null }))
    expect((await identity.load()).name).toBe('User 7')
  })

  it('normalises absent optional claims to null', async () => {
    call.mockResolvedValue(userinfo({ sub: '7', name: 'Dana' }))
    expect(await identity.load()).toMatchObject({ email: null, profileId: null, profileType: null })
  })

  it('throws when there is no subject claim', async () => {
    call.mockResolvedValue(userinfo({ name: 'Dana' }))
    await expect(identity.load()).rejects.toThrow(/subject claim/i)
  })

  it('caches, so a second load makes no call', async () => {
    call.mockResolvedValue(userinfo({ sub: '7', name: 'Dana' }))
    await identity.load()
    await identity.load()
    expect(call).toHaveBeenCalledOnce()
  })

  it('persists, so a fresh store reads it without a call', async () => {
    call.mockResolvedValue(userinfo({ sub: '7', name: 'Dana' }))
    await identity.load()

    const revived = new IdentityStore({ keys, call: call as never })
    expect(revived.current?.name).toBe('Dana')
    expect(call).toHaveBeenCalledOnce()
  })
})

describe('current', () => {
  it('is null before anything is loaded', () => {
    expect(identity.current).toBeNull()
  })

  it('is null when no environment is selected, rather than throwing', () => {
    keys.clearEnvironmentId()
    expect(identity.current).toBeNull()
  })

  it('ignores a corrupt stored value', () => {
    storage.seed('app:staging:identity', '{ not json')
    expect(identity.current).toBeNull()
  })

  it('ignores a stored value missing its subject', () => {
    storage.seed('app:staging:identity', JSON.stringify({ name: 'Dana' }))
    expect(identity.current).toBeNull()
  })

  it('never lets one environment see another identity', async () => {
    call.mockResolvedValue(userinfo({ sub: '7', name: 'Staging Dana' }))
    await identity.load()

    keys.setEnvironmentId('production')
    expect(identity.current).toBeNull()

    call.mockResolvedValue(userinfo({ sub: '9', name: 'Production Dana' }))
    expect((await identity.load()).name).toBe('Production Dana')

    keys.setEnvironmentId('staging')
    expect(identity.current?.name).toBe('Staging Dana')
  })
})

describe('clear', () => {
  it('drops both the persisted and in-memory copies', async () => {
    call.mockResolvedValue(userinfo({ sub: '7', name: 'Dana' }))
    await identity.load()
    identity.clear()
    expect(identity.current).toBeNull()
    expect(storage.dump()['app:staging:identity']).toBeUndefined()
  })
})
