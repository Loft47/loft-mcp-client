import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrokerageStore } from '../src/brokerage'
import { KeyStore } from '../src/storage'
import { fakeStorage } from './helpers/fakeStorage'
import type { FakeStorage } from './helpers/fakeStorage'

let storage: FakeStorage
let keys: KeyStore
let call: ReturnType<typeof vi.fn>
let brokerages: BrokerageStore

beforeEach(() => {
  storage = fakeStorage()
  keys = new KeyStore({ prefix: 'app', storage, session: fakeStorage() })
  keys.setEnvironmentId('staging')
  call = vi.fn()
  brokerages = new BrokerageStore({ keys, call: call as never })
})

describe('the remembered default', () => {
  it('starts unset', () => expect(brokerages.current).toBeNull())

  it('round-trips through storage', () => {
    brokerages.set(45)
    expect(brokerages.current).toBe(45)
    expect(storage.dump()['app:staging:brokerage_id']).toBe('45')
  })

  it('clears', () => {
    brokerages.set(45)
    brokerages.clear()
    expect(brokerages.current).toBeNull()
  })

  it('is remembered per environment', () => {
    brokerages.set(45)
    keys.setEnvironmentId('production')
    expect(brokerages.current).toBeNull()
    brokerages.set(99)
    keys.setEnvironmentId('staging')
    expect(brokerages.current).toBe(45)
  })

  it('ignores a non-numeric stored value', () => {
    storage.seed('app:staging:brokerage_id', 'not-a-number')
    expect(brokerages.current).toBeNull()
  })

  it('returns null when no environment is selected', () => {
    keys.clearEnvironmentId()
    expect(brokerages.current).toBeNull()
  })
})

describe('list', () => {
  it('asks for an empty include and a large page', async () => {
    // The default include set returns every deduction template and broker on
    // every brokerage, which runs to megabytes.
    call.mockResolvedValue({ data: [] })
    await brokerages.list()
    expect(call).toHaveBeenCalledWith('ListBrokerages', { include: '', page_size: 100 })
  })

  it('lets the caller override paging and search', async () => {
    call.mockResolvedValue({ data: [] })
    await brokerages.list({ page_number: 2, page_size: 25, filter_search: 'acme' })
    expect(call).toHaveBeenCalledWith('ListBrokerages', {
      include: '',
      page_size: 25,
      page_number: 2,
      filter_search: 'acme',
    })
  })
})

describe('choices', () => {
  it('flattens, marks inactive rows and sorts by name', async () => {
    call.mockResolvedValue({
      data: [
        {
          id: '99', type: 'brokerage',
          attributes: {
            id: 99, name: 'Zenith Realty', legalName: 'Zenith Realty Ltd', franchiseName: null,
            country: 'CA', currency: 'CAD', inactiveDate: '2025-01-01',
          },
        },
        {
          id: '45', type: 'brokerage',
          attributes: {
            id: 45, name: 'Acme Realty', legalName: null, franchiseName: 'Acme Group',
            country: 'US', currency: 'USD', inactiveDate: null,
          },
        },
      ],
    })

    expect(await brokerages.choices()).toEqual([
      {
        id: 45, name: 'Acme Realty', legalName: null, franchiseName: 'Acme Group',
        country: 'US', currency: 'USD', inactive: false,
      },
      {
        id: 99, name: 'Zenith Realty', legalName: 'Zenith Realty Ltd', franchiseName: null,
        country: 'CA', currency: 'CAD', inactive: true,
      },
    ])
  })

  it('returns an empty array when the account has no brokerages', async () => {
    call.mockResolvedValue({ data: [] })
    expect(await brokerages.choices()).toEqual([])
  })
})
