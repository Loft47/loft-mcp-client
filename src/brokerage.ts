/**
 * Which brokerage this session is working in, and which ones it may choose from.
 *
 * `ListBrokerages` is scoped to the signed-in user's access, so most accounts
 * see exactly one row. The choice is remembered per environment: "brokerage 45"
 * names different companies in staging and production.
 */

import { list } from './jsonapi.js'
import type { Doc } from './jsonapi.js'
import type { KeyStore } from './storage.js'

export interface BrokerageAttrs {
  id: number
  name: string
  legalName: string | null
  franchiseName: string | null
  subdomain: string | null
  inactiveDate: string | null
  country: string | null
  currency: string | null
}

/** A brokerage flattened for a picker. */
export interface BrokerageChoice {
  id: number
  name: string
  legalName: string | null
  franchiseName: string | null
  country: string | null
  currency: string | null
  inactive: boolean
}

export interface BrokerageStoreOptions {
  keys: KeyStore
  call: <T>(name: string, args?: Record<string, unknown>) => Promise<T>
}

export interface ListBrokeragesOptions {
  page_number?: number
  page_size?: number
  filter_search?: string
}

export class BrokerageStore {
  private readonly keys: KeyStore
  private readonly call: <T>(name: string, args?: Record<string, unknown>) => Promise<T>

  constructor(opts: BrokerageStoreOptions) {
    this.keys = opts.keys
    this.call = opts.call
  }

  get current(): number | null {
    const stored = this.keys.read('brokerage_id')
    if (stored === null) return null
    const id = Number(stored)
    return Number.isFinite(id) ? id : null
  }

  set(id: number): void {
    this.keys.write('brokerage_id', String(id))
  }

  clear(): void {
    try {
      this.keys.remove('brokerage_id')
    } catch {
      // No environment selected; nothing stored.
    }
  }

  /**
   * `include: ''` keeps the payload small — the default include set returns
   * every deduction template and broker on every brokerage, which is megabytes.
   */
  list(opts: ListBrokeragesOptions = {}): Promise<Doc<BrokerageAttrs>> {
    return this.call<Doc<BrokerageAttrs>>('ListBrokerages', {
      include: '',
      page_size: 100,
      ...opts,
    })
  }

  /** The list flattened and sorted for a picker. */
  async choices(): Promise<BrokerageChoice[]> {
    const doc = await this.list()
    return list<BrokerageAttrs>(doc)
      .map((resource) => ({
        id: resource.attributes.id,
        name: resource.attributes.name,
        legalName: resource.attributes.legalName,
        franchiseName: resource.attributes.franchiseName,
        country: resource.attributes.country,
        currency: resource.attributes.currency,
        inactive: Boolean(resource.attributes.inactiveDate),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }
}
