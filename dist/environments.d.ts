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
export type EnvId = string;
export interface LoftEnvironment {
    id: EnvId;
    label: string;
    description: string;
    /** The real MCP host. Shown to users; requests go through `proxyPrefix`. */
    mcpHost: string;
    /** Base URL of the Loft47 web app, for deep links back into a record. */
    appBase: string;
    /** Same-origin path prefix a dev server proxies to `mcpHost`. No trailing slash. */
    proxyPrefix: string;
}
export declare const LOFT_ENVIRONMENTS: Record<string, LoftEnvironment>;
/** Staging first, deliberately: the safe choice leads. */
export declare const LOFT_ENVIRONMENT_LIST: LoftEnvironment[];
//# sourceMappingURL=environments.d.ts.map