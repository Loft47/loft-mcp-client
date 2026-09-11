import type { StorageLike } from '../../src/storage.js'

export interface FakeStorage extends StorageLike {
  dump(): Record<string, string>
  seed(key: string, value: string): void
  failWrites: boolean
}

/** A `StorageLike` backed by a Map, with an opt-in write failure for the quota path. */
export function fakeStorage(opts: { failWrites?: boolean } = {}): FakeStorage {
  const map = new Map<string, string>()
  return {
    failWrites: opts.failWrites ?? false,
    get length() {
      return map.size
    },
    key(index: number) {
      return [...map.keys()][index] ?? null
    },
    getItem(key: string) {
      return map.get(key) ?? null
    },
    setItem(key: string, value: string) {
      if (this.failWrites) throw new DOMException('QuotaExceededError')
      map.set(key, value)
    },
    removeItem(key: string) {
      map.delete(key)
    },
    dump() {
      return Object.fromEntries(map)
    },
    seed(key: string, value: string) {
      map.set(key, value)
    },
  }
}
