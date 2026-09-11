import { describe, expect, it } from 'vitest'
import { LOFT_ENVIRONMENTS, LOFT_ENVIRONMENT_LIST } from '../src/environments'

describe('LOFT_ENVIRONMENTS', () => {
  it('ships staging and production', () => {
    expect(Object.keys(LOFT_ENVIRONMENTS).sort()).toEqual(['production', 'staging'])
  })

  it('lists staging first, so the safe choice leads', () => {
    expect(LOFT_ENVIRONMENT_LIST.map((e) => e.id)).toEqual(['staging', 'production'])
  })

  it('gives every environment a distinct host and proxy prefix', () => {
    const hosts = LOFT_ENVIRONMENT_LIST.map((e) => e.mcpHost)
    const prefixes = LOFT_ENVIRONMENT_LIST.map((e) => e.proxyPrefix)
    expect(new Set(hosts).size).toBe(hosts.length)
    expect(new Set(prefixes).size).toBe(prefixes.length)
  })

  it('uses absolute https hosts and root-relative prefixes', () => {
    for (const env of LOFT_ENVIRONMENT_LIST) {
      expect(env.mcpHost).toMatch(/^https:\/\//)
      expect(env.appBase).toMatch(/^https:\/\//)
      expect(env.proxyPrefix.startsWith('/')).toBe(true)
      expect(env.proxyPrefix.endsWith('/')).toBe(false)
    }
  })

  it('keys each entry by its own id', () => {
    for (const [key, env] of Object.entries(LOFT_ENVIRONMENTS)) expect(env.id).toBe(key)
  })
})
