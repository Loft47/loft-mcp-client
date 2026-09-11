/**
 * Which Loft47 environments exist.
 *
 * Pure data. This module is imported by `loft-mcp-client/vite`, which runs in
 * Node, so it must never touch `window`, `localStorage` or `crypto`.
 *
 * Environments are hard-isolated by the client: tokens, the registered OAuth
 * client, the MCP session, the selected brokerage and any app state are all
 * namespaced by environment id. A staging token must never be presented to
 * production, and "brokerage 45" names different companies in the two systems.
 */

/** Not a closed union: the registry is overridable, so an app may add a local environment. */
export type EnvId = string

export interface LoftEnvironment {
  id: EnvId
  label: string
  description: string
  /** The real MCP host. Shown to users; requests go through `proxyPrefix`. */
  mcpHost: string
  /** Base URL of the Loft47 web app, for deep links back into a record. */
  appBase: string
  /** Same-origin path prefix a dev server proxies to `mcpHost`. No trailing slash. */
  proxyPrefix: string
}

export const LOFT_ENVIRONMENTS: Record<string, LoftEnvironment> = {
  staging: {
    id: 'staging',
    label: 'Staging',
    description: 'Test data. Safe to explore — nothing here affects a real brokerage.',
    mcpHost: 'https://mcp.staging.loft47.com',
    appBase: 'https://staging.loft47.com',
    proxyPrefix: '/loft/staging',
  },
  production: {
    id: 'production',
    label: 'Production',
    description: 'Live brokerage data. Read-only, but these are real commissions and real people.',
    mcpHost: 'https://mcp.loft47.com',
    appBase: 'https://app.loft47.com',
    proxyPrefix: '/loft/production',
  },
}

/** Staging first, deliberately: the safe choice leads. */
export const LOFT_ENVIRONMENT_LIST: LoftEnvironment[] = [
  LOFT_ENVIRONMENTS.staging!,
  LOFT_ENVIRONMENTS.production!,
]
