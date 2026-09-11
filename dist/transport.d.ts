/**
 * JSON-RPC 2.0 over HTTP to the MCP server.
 *
 * Requests go to a same-origin path, because the MCP hosts send no CORS headers
 * and a direct browser call is blocked. The server may answer as JSON or as an
 * SSE stream, so both are handled.
 *
 * A single screen can fan out to several calls per record across a hundred or
 * more records, so this module also de-duplicates identical in-flight requests
 * and caps concurrency. Without both, the browser queues hundreds of sockets and
 * the run crawls.
 */
import type { KeyStore } from './storage.js';
export interface TransportOptions {
    keys: KeyStore;
    /** Same-origin URL of the MCP endpoint for the active environment. */
    endpoint: () => string;
    getAccessToken: () => Promise<string>;
    /**
     * Renews unconditionally when `knownBadToken` is the token still on record —
     * the transport passes the exact token the server 401'd, so a renewal is not
     * skipped just because that token still looks fresh locally.
     */
    forceRefresh: (knownBadToken: string) => Promise<string>;
    onAuthExpired: () => void;
    clientInfo: {
        name: string;
        version: string;
    };
    /** Keep this modest; the API is not built for a wide fan-out. */
    maxConcurrent?: number;
    fetchImpl?: typeof fetch;
}
export declare class Transport {
    private readonly keys;
    private readonly endpoint;
    private readonly getAccessToken;
    private readonly forceRefresh;
    private readonly onAuthExpired;
    private readonly clientInfo;
    private readonly maxConcurrent;
    private readonly fetchImpl;
    private sessionId;
    private initialized;
    private initInFlight;
    private requestId;
    private active;
    private readonly waiting;
    private readonly inflight;
    constructor(opts: TransportOptions);
    /** Adopts this environment's stored session. Call after the environment is set. */
    primeSession(): void;
    resetSession(): void;
    /**
     * Calls a tool. Identical concurrent calls share one request, which matters
     * when several independent callers want the same record's data.
     */
    call<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
    private callOnce;
    /**
     * Single-flight, for the same reason refresh is: `maxConcurrent` is 6, so six
     * cold calls can reach this together. Without coalescing they send six
     * handshakes and strand five server-side sessions, of which only the last
     * `Mcp-Session-Id` is ever used again.
     */
    private ensureInitialized;
    private runInitialize;
    /**
     * `ctx.retryAfterToken` is set only on the one retry a 401 earns, and carries
     * the exact token the server rejected. `ctx.label` names the tool (or the
     * handshake) in any error raised from here.
     */
    private post;
    /**
     * `forceRefresh` distinguishes a dead grant from a blip: it throws
     * `AuthExpiredError` only when the credentials are permanently gone, and a
     * plain `Error` for anything transient (network error, 5xx, 429) — see
     * `tokens.ts`. Only the former may end the session; a transient failure must
     * propagate untouched, with the session and credentials left intact, so the
     * next call can retry.
     */
    private forceRefreshOrExpire;
    private acquire;
    private release;
}
//# sourceMappingURL=transport.d.ts.map