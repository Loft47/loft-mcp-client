import { describe, expect, it } from 'vitest'
import {
  attrs, centsOr0, findIncluded, includedIndex, list, one,
  relId, relIds, toCents, toDate, toNumber,
} from '../src/jsonapi'
import type { Doc, Resource } from '../src/jsonapi'

const res = (id: string, type: string, a: Record<string, unknown> = {}): Resource => ({
  id, type, attributes: a,
})

describe('list', () => {
  it('wraps a single resource in an array', () => {
    expect(list({ data: res('1', 'deal') })).toHaveLength(1)
  })
  it('returns an array unchanged', () => {
    expect(list({ data: [res('1', 'deal'), res('2', 'deal')] })).toHaveLength(2)
  })
  it('returns empty for null data, null doc and undefined', () => {
    expect(list({ data: null })).toEqual([])
    expect(list(null)).toEqual([])
    expect(list(undefined)).toEqual([])
  })
})

describe('one and attrs', () => {
  it('takes the first of an array', () => {
    expect(one({ data: [res('7', 'deal'), res('8', 'deal')] })?.id).toBe('7')
  })
  it('returns null for an empty array', () => {
    expect(one({ data: [] })).toBeNull()
  })
  it('reads attributes of the single resource', () => {
    const doc: Doc<{ name: string }> = { data: { id: '1', type: 'b', attributes: { name: 'Acme' } } }
    expect(attrs(doc)?.name).toBe('Acme')
  })
  it('returns null attributes when there is no data', () => {
    expect(attrs({ data: null })).toBeNull()
  })
})

describe('relationships', () => {
  const withRels: Resource = {
    id: '1', type: 'deal', attributes: {},
    relationships: {
      office: { data: { id: '9', type: 'office' } },
      agents: { data: [{ id: '3', type: 'profile' }, { id: '4', type: 'profile' }] },
      empty: { data: null },
    },
  }
  it('reads a to-one id', () => expect(relId(withRels, 'office')).toBe('9'))
  it('returns null for a to-many read as to-one', () => expect(relId(withRels, 'agents')).toBeNull())
  it('returns null for a null relationship and an unknown name', () => {
    expect(relId(withRels, 'empty')).toBeNull()
    expect(relId(withRels, 'nope')).toBeNull()
  })
  it('reads to-many ids', () => expect(relIds(withRels, 'agents')).toEqual(['3', '4']))
  it('returns empty for a to-one read as to-many', () => expect(relIds(withRels, 'office')).toEqual([]))
})

describe('includedIndex and findIncluded', () => {
  it('indexes by type:id and resolves', () => {
    const doc: Doc = { data: null, included: [res('9', 'office', { name: 'Main' })] }
    const index = includedIndex(doc)
    expect(findIncluded(index, 'office', '9')?.attributes.name).toBe('Main')
    expect(findIncluded(index, 'office', null)).toBeNull()
    expect(findIncluded(index, 'profile', '9')).toBeNull()
  })
})

describe('toCents', () => {
  it('parses a decimal string', () => expect(toCents('17950.0')).toBe(1795000))
  it('parses a bare number', () => expect(toCents(17950)).toBe(1795000))
  it('parses a negative value', () => expect(toCents('-250.55')).toBe(-25055))
  it('strips thousands separators', () => expect(toCents('1,234.50')).toBe(123450))
  it('rounds rather than truncating', () => expect(toCents('0.005')).toBe(1))
  it('returns null for null, undefined and empty string', () => {
    expect(toCents(null)).toBeNull()
    expect(toCents(undefined)).toBeNull()
    expect(toCents('')).toBeNull()
  })
  it('returns null for non-numeric text', () => expect(toCents('n/a')).toBeNull())
  it('treats missing as zero via centsOr0', () => {
    expect(centsOr0(null)).toBe(0)
    expect(centsOr0('12.34')).toBe(1234)
  })
})

describe('toNumber and toDate', () => {
  it('parses numbers and rejects junk', () => {
    expect(toNumber('0.5')).toBe(0.5)
    expect(toNumber(2)).toBe(2)
    expect(toNumber('')).toBeNull()
    expect(toNumber('abc')).toBeNull()
  })
  it('parses dates and rejects junk', () => {
    expect(toDate('2026-09-10')?.getUTCFullYear()).toBe(2026)
    expect(toDate('')).toBeNull()
    expect(toDate(null)).toBeNull()
    expect(toDate('not a date')).toBeNull()
    expect(toDate(12345)).toBeNull()
  })
})
