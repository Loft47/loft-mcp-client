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
export const LOFT_ENVIRONMENTS = {
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
};
/** Staging first, deliberately: the safe choice leads. */
export const LOFT_ENVIRONMENT_LIST = [
    LOFT_ENVIRONMENTS.staging,
    LOFT_ENVIRONMENTS.production,
];
//# sourceMappingURL=environments.js.map