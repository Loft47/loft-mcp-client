/**
 * Dev-server proxy configuration, derived from the environment registry.
 *
 * The MCP hosts send no CORS headers, so a browser cannot call them directly.
 * Requests go to a same-origin prefix instead, which the dev server forwards.
 *
 * This module runs in Node, inside `vite.config.ts`. It must import nothing
 * browser-only — hence `../environments` rather than anything else in the
 * package.
 *
 * Both prefixes are configured at once, deliberately. That is what makes the
 * environment a runtime choice rather than a rebuild.
 *
 * The return type is structural rather than Vite's own `ProxyOptions`, so this
 * package needs no dependency on Vite and no coupling to a Vite major.
 *
 * ```ts
 * import { loftMcpProxy } from 'loft-mcp-client/vite'
 *
 * export default defineConfig({
 *   server: { proxy: { ...loftMcpProxy() } },
 *   preview: { proxy: { ...loftMcpProxy() } },
 * })
 * ```
 *
 * A proxy is a dev-server feature. A static production build has none, so a
 * deployed app needs CORS on the MCP server or its own reverse proxy — point
 * the client's `baseUrl` option at it.
 */

import { LOFT_ENVIRONMENTS } from '../environments.js'
import type { LoftEnvironment } from '../environments.js'

export interface LoftProxyEntry {
  target: string
  changeOrigin: boolean
  secure: boolean
  rewrite: (path: string) => string
}

export interface LoftMcpProxyOptions {
  environments?: Record<string, LoftEnvironment>
  /** Defaults to the registry's own `proxyPrefix`. */
  prefix?: (env: LoftEnvironment) => string
}

export function loftMcpProxy(opts: LoftMcpProxyOptions = {}): Record<string, LoftProxyEntry> {
  const environments = opts.environments ?? LOFT_ENVIRONMENTS
  const prefixFor = opts.prefix ?? ((env: LoftEnvironment) => env.proxyPrefix)

  const entries = Object.values(environments).map((env) => {
    const prefix = prefixFor(env)
    return [
      prefix,
      {
        target: env.mcpHost,
        changeOrigin: true,
        secure: true,
        // Leading occurrence only: a path may legitimately repeat the prefix.
        rewrite: (path: string) => (path.startsWith(prefix) ? path.slice(prefix.length) : path),
      },
    ] as const
  })

  return Object.fromEntries(entries)
}
