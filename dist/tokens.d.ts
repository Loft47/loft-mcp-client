/**
 * The access token's whole life: where its expiry comes from, when it is
 * renewed, what happens when renewal fails, and how two tabs avoid fighting
 * over it.
 *
 * Three triggers keep a token fresh, because none is sufficient alone:
 *
 *  1. A timer at `expiresAt - skew`. Background tabs have their timers
 *     throttled or suspended, so this fires late or not until refocus — it is an
 *     optimisation, not a guarantee.
 *  2. `ensureFresh()`, called before every request. This is the guarantee.
 *  3. A 401 from the server, handled in `transport.ts`, covering clock skew and
 *     revocation.
 *
 * Refresh is single-flight. Six concurrent requests can meet an expired token
 * at once; six parallel refreshes against a server that rotates refresh tokens
 * means five present a token the first already invalidated, and the session
 * dies. Every caller awaits one promise.
 */
import type { KeyStore } from './storage.js';
import type { TokenEndpointResult } from './oauth.js';
export interface RawTokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    [key: string]: unknown;
}
export type RefreshOutcome = {
    ok: true;
    raw: RawTokenResponse;
}
/** `transient` decides whether the session survives. See spec §6. */
 | {
    ok: false;
    transient: boolean;
    message: string;
};
/** The `exp` claim in epoch milliseconds, or null if the token is opaque. */
export declare function jwtExp(token: string): number | null;
/**
 * Best source first: what the server said, then what the token itself claims,
 * then the configured default. An expired `exp` is honoured rather than masked —
 * refreshing is the right response to a token the server would reject anyway.
 */
export declare function deriveExpiresAt(raw: RawTokenResponse, opts: {
    defaultTtlSeconds: number;
    now: number;
}): number;
/**
 * Decides whether a token-endpoint response ends the session. Getting this
 * wrong in either direction is bad: treating a network blip as permanent signs
 * people out for no reason, and treating a revoked grant as transient retries
 * forever.
 */
export declare function classifyTokenResult(result: TokenEndpointResult): RefreshOutcome;
export interface TokenManagerOptions {
    keys: KeyStore;
    defaultTtlSeconds: number;
    skewSeconds: number;
    refresh: (refreshToken: string) => Promise<RefreshOutcome>;
    /** Called once when credentials are permanently gone. */
    onExpired: () => void;
    onRenewed?: (accessToken: string) => void;
    now?: () => number;
}
export declare class TokenManager {
    private readonly keys;
    private readonly defaultTtlSeconds;
    private readonly skewMs;
    private readonly doRefreshCall;
    private readonly onExpired;
    private readonly onRenewed;
    private readonly now;
    private timer;
    private refreshInFlight;
    private detachStorage;
    constructor(opts: TokenManagerOptions);
    get accessToken(): string | null;
    get refreshToken(): string | null;
    get expiresAt(): number | null;
    get isAuthenticated(): boolean;
    /** False when the expiry is unknown: let a 401 decide rather than guessing. */
    isStale(): boolean;
    store(raw: RawTokenResponse): void;
    /** Removes only the token triple. Identity and session are the client's job. */
    clear(): void;
    /** Re-arms the renewal timer against whatever is currently stored. */
    rearm(): void;
    ensureFresh(): Promise<string>;
    /**
     * Renews the access token, coalescing concurrent callers onto one request.
     *
     * `knownBad` names a token the caller has proof the server rejects — a 401,
     * in practice. Without it this is "refresh if stale", and a caller holding a
     * token that is locally fresh but dead at the server (clock skew, an expiry
     * the server never told us, revocation) gets that same dead token handed
     * straight back. Passing it skips the freshness short-circuit, but only when
     * the named token is still the one stored: if another tab has replaced it
     * since, the short-circuit is exactly right and still applies.
     */
    refreshNow(knownBad?: string): Promise<string>;
    private performRefresh;
    /**
     * A permanent failure — unless another tab wrote a newer token while this
     * refresh was in flight, which is exactly what happens when both tabs renew
     * at once and the server rotates refresh tokens. Adopting beats signing out.
     */
    private giveUp;
    private arm;
    private disarm;
    /**
     * Watches for another tab writing this environment's token, and re-arms
     * against the new expiry. Adoption itself is free — reads hit storage.
     */
    attachStorageListener(target?: EventTarget): () => void;
    dispose(): void;
}
//# sourceMappingURL=tokens.d.ts.map