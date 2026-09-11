/**
 * The sign-in flow, end to end.
 *
 *   signIn()          register a client, mint a PKCE pair, navigate to authorize
 *   completeSignIn()  exchange the returned code for tokens
 *   refresh()         swap a refresh token for a new access token
 *
 * `completeSignIn` returns the raw token response instead of storing it. The
 * token manager needs `refresh` from here, and storing here would need the
 * token manager — returning the payload breaks that cycle and leaves the client
 * as the single place tokens are written.
 *
 * **No `scope` is sent, deliberately.** The staging discovery document
 * advertises `scopes_supported: ["public"]`, and neither the authorization
 * request nor the token exchange below includes a `scope` parameter — the
 * server grants what it grants. No option exposes one either: a `scope` option
 * is permanent public API surface, and nothing observed against this host needs
 * it. Recorded in spec §11 so the omission reads as a decision rather than an
 * oversight. Add it only when a real caller needs a narrower grant.
 */
import type { RawTokenResponse, RefreshOutcome } from './tokens.js';
import type { OAuthEndpoints } from './oauth.js';
import type { KeyStore } from './storage.js';
import type { LoftEnvironment } from './environments.js';
export interface AuthFlowOptions {
    keys: KeyStore;
    oauth: OAuthEndpoints;
    /** Throws `NoEnvironmentError` when nothing is selected. */
    env: () => LoftEnvironment;
    appName: string;
    redirectUri: string;
    navigate: (url: string) => void;
}
export declare class AuthFlow {
    private readonly keys;
    private readonly oauth;
    private readonly env;
    private readonly appName;
    private readonly redirectUri;
    private readonly navigate;
    constructor(opts: AuthFlowOptions);
    /**
     * Registers a client and navigates away. Registration happens every time: the
     * server's registrations do not survive a redeploy, and a stale client id
     * lands the browser on a server-rendered error page this app never sees.
     */
    signIn(): Promise<void>;
    completeSignIn(code: string): Promise<RawTokenResponse>;
    refresh(refreshToken: string): Promise<RefreshOutcome>;
    /** Registers and persists, replacing any previous registration. */
    private registerFresh;
    /**
     * The client the authorize step used. The token exchange and the refresh must
     * present that exact id, so this never re-registers when one is stored. It
     * does register when nothing is — after a reload the refresh token survives
     * in storage and must remain usable.
     */
    private storedClient;
}
//# sourceMappingURL=auth.d.ts.map