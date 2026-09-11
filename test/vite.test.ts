import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loftMcpProxy } from '../src/vite/index.js'
import { LOFT_ENVIRONMENTS } from '../src/environments.js'

describe('loftMcpProxy', () => {
  it('proxies every environment at once, which is what makes the choice a runtime one', () => {
    expect(Object.keys(loftMcpProxy()).sort()).toEqual(['/loft/production', '/loft/staging'])
  })

  it('derives targets from the registry, so config and client cannot drift', () => {
    const proxy = loftMcpProxy()
    expect(proxy['/loft/staging']!.target).toBe(LOFT_ENVIRONMENTS.staging!.mcpHost)
    expect(proxy['/loft/production']!.target).toBe(LOFT_ENVIRONMENTS.production!.mcpHost)
  })

  it('rewrites the host header and verifies TLS', () => {
    const entry = loftMcpProxy()['/loft/staging']!
    expect(entry.changeOrigin).toBe(true)
    expect(entry.secure).toBe(true)
  })

  it('strips the prefix so the upstream sees its own paths', () => {
    const { rewrite } = loftMcpProxy()['/loft/staging']!
    expect(rewrite('/loft/staging/mcp')).toBe('/mcp')
    expect(rewrite('/loft/staging/.well-known/oauth-authorization-server')).toBe(
      '/.well-known/oauth-authorization-server',
    )
  })

  it('strips only the leading occurrence of the prefix', () => {
    const { rewrite } = loftMcpProxy()['/loft/staging']!
    expect(rewrite('/loft/staging/x/loft/staging')).toBe('/x/loft/staging')
  })

  it('accepts a prefix override for apps whose own routes collide', () => {
    const proxy = loftMcpProxy({ prefix: (env) => `/upstream/${env.id}` })
    expect(Object.keys(proxy).sort()).toEqual(['/upstream/production', '/upstream/staging'])
    expect(proxy['/upstream/staging']!.rewrite('/upstream/staging/mcp')).toBe('/mcp')
  })

  it('accepts a custom registry', () => {
    const proxy = loftMcpProxy({
      environments: {
        local: {
          id: 'local', label: 'Local', description: 'A local server',
          mcpHost: 'http://localhost:3000', appBase: 'http://localhost:3000',
          proxyPrefix: '/loft/local',
        },
      },
    })
    expect(Object.keys(proxy)).toEqual(['/loft/local'])
    expect(proxy['/loft/local']!.target).toBe('http://localhost:3000')
  })
})

describe('Node safety', () => {
  it('imports nothing beyond the pure environments module', () => {
    // Use process.cwd() since import.meta.url is not reliable in jsdom
    const filePath = `${process.cwd()}/src/vite/index.ts`
    const source = readFileSync(filePath, 'utf8')
    // Remove multi-line comments and single-line comments, then check imports
    const withoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    const specifiers = [...withoutComments.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
    // Should only have the environments imports (value and type)
    expect(specifiers).toEqual(['../environments.js', '../environments.js'])
  })
})
