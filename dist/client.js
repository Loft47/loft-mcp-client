/**
 * The one object an app holds.
 *
 * Everything is instance state rather than module state: `storage`, `navigate`
 * and `fetch` are injectable, two clients can coexist, and nothing leaks
 * between tests.
 */
import { AuthFlow } from './auth.js';
import { BrokerageStore } from './brokerage.js';
import { IdentityStore } from './identity.js';
import { NoEnvironmentError } from './errors.js';
import { LOFT_ENVIRONMENTS } from './environments.js';
import { OAuthEndpoints } from './oauth.js';
import { KeyStore } from './storage.js';
import { TokenManager } from './tokens.js';
import { Transport } from './transport.js';
export function createLoftMcpClient(options) {
    const registry = options.environments ?? LOFT_ENVIRONMENTS;
    const environmentList = Object.values(registry);
    const keys = new KeyStore({
        prefix: options.storagePrefix,
        storage: options.storage ?? window.localStorage,
        session: options.sessionStore ?? window.sessionStorage,
        onStorageError: options.onStorageError,
    });
    const listeners = new Set();
    const notify = () => {
        for (const listener of listeners) {
            try {
                listener();
            }
            catch {
                // One bad subscriber must not stop the others.
            }
        }
    };
    const environmentOrNull = () => {
        const id = keys.environmentId;
        return id ? (registry[id] ?? null) : null;
    };
    const requireEnvironment = () => {
        const env = environmentOrNull();
        if (!env)
            throw new NoEnvironmentError();
        return env;
    };
    const baseUrl = options.baseUrl ?? ((env) => env.proxyPrefix);
    const oauth = new OAuthEndpoints({ baseUrl, fetchImpl: options.fetchImpl });
    const auth = new AuthFlow({
        keys,
        oauth,
        env: requireEnvironment,
        appName: options.appName,
        redirectUri: options.redirectUri ?? window.location.origin,
        navigate: options.navigate ?? ((url) => { window.location.href = url; }),
    });
    /**
     * One dead session reaches here twice. `TokenManager.giveUp()` fires its
     * `onExpired` and then throws `AuthExpiredError`, which `Transport` catches
     * and reports through its own `onAuthExpired`. The teardown below is
     * idempotent, but `options.onAuthExpired` is the consumer's callback and
     * must fire once per death — so it is latched, and the latch reopens the
     * moment a token is stored again.
     */
    let expiryReported = false;
    const reportExpired = () => {
        identity.clear();
        transport.resetSession();
        if (expiryReported)
            return;
        expiryReported = true;
        options.onAuthExpired?.();
        notify();
    };
    const tokens = new TokenManager({
        keys,
        defaultTtlSeconds: options.defaultTokenTtlSeconds ?? 1800,
        skewSeconds: options.refreshSkewSeconds ?? 120,
        refresh: (refreshToken) => auth.refresh(refreshToken),
        onExpired: reportExpired,
        onRenewed: () => {
            expiryReported = false;
            notify();
        },
    });
    const transport = new Transport({
        keys,
        endpoint: () => `${baseUrl(requireEnvironment())}/mcp`,
        getAccessToken: () => tokens.ensureFresh(),
        // The transport hands back the exact token the server 401'd, so a renewal
        // happens even when that token still looks fresh from here.
        forceRefresh: (knownBadToken) => tokens.refreshNow(knownBadToken),
        onAuthExpired: () => {
            tokens.clear();
            reportExpired();
        },
        clientInfo: { name: options.appName, version: options.appVersion ?? '0.0.0' },
        maxConcurrent: options.maxConcurrent,
        fetchImpl: options.fetchImpl,
    });
    const call = (name, args = {}) => transport.call(name, args);
    const identity = new IdentityStore({ keys, call });
    const brokerages = new BrokerageStore({ keys, call });
    // Adopt this environment's stored session before anything goes out.
    if (environmentOrNull())
        transport.primeSession();
    // Two listeners, two jobs: the token manager re-arms its renewal timer
    // against whatever another tab wrote, and the key store drops its
    // stale-mirror flag for that key because storage is authoritative again.
    const detachStorage = typeof window === 'undefined'
        ? () => { }
        : (() => {
            const detachTokens = tokens.attachStorageListener(window);
            const detachKeys = keys.attachStorageListener(window);
            return () => {
                detachTokens();
                detachKeys();
            };
        })();
    return {
        get environments() {
            return environmentList;
        },
        get environment() {
            return environmentOrNull();
        },
        setEnvironment(id) {
            if (!registry[id])
                throw new Error(`Unknown environment: ${id}`);
            // Reset local transport bookkeeping (session id, initialized flag,
            // in-flight dedup) while NO environment is selected, so resetSession's
            // internal keys.remove('mcp_session') is a no-op instead of deleting
            // whichever environment's persisted session happens to be "current" —
            // neither the one being left nor the one being entered.
            keys.clearEnvironmentId();
            transport.resetSession();
            keys.setEnvironmentId(id);
            transport.primeSession();
            tokens.rearm();
            // A different environment is a different session; whatever expired in
            // the last one must not silence the next one's expiry.
            expiryReported = false;
            notify();
        },
        clearEnvironment() {
            keys.clearEnvironmentId();
            transport.resetSession();
            tokens.rearm();
            expiryReported = false;
            notify();
        },
        get isAuthenticated() {
            return tokens.isAuthenticated;
        },
        signIn: () => auth.signIn(),
        async completeSignIn(code) {
            tokens.store(await auth.completeSignIn(code));
            expiryReported = false;
            notify();
        },
        async getAccessToken() {
            // Same ordering as the transport: a missing environment is a typed
            // NoEnvironmentError (spec §6), not "no access token".
            requireEnvironment();
            return tokens.ensureFresh();
        },
        revoke(opts = {}) {
            // Not tokens.dispose(): that also detaches the cross-tab storage
            // listener permanently (it is only ever attached once, in the factory),
            // which would kill multi-tab sync for the rest of this client's life —
            // including after a subsequent sign-in in the same tab. clear() already
            // disarms the timer.
            //
            // Every key these three touch is environment-scoped, so with nothing
            // selected there is nothing for them to clear — and tokens.clear() would
            // throw NoEnvironmentError out of keys.remove() before the purge below
            // ever ran, taking the §7 `:unset:` orphan sweep with it. Every sibling
            // (clearEnvironment, clearBrokerage, resetSession) is already guarded.
            if (environmentOrNull()) {
                tokens.clear();
                identity.clear();
                transport.resetSession();
            }
            if (opts.purge)
                keys.purge();
            else {
                keys.clearLibraryKeys();
                keys.clearEnvironmentId();
            }
            expiryReported = false;
            notify();
        },
        get identity() {
            return identity.current;
        },
        async loadIdentity() {
            const resolved = await identity.load();
            notify();
            return resolved;
        },
        get brokerageId() {
            return brokerages.current;
        },
        setBrokerage(id) {
            brokerages.set(id);
            notify();
        },
        clearBrokerage() {
            brokerages.clear();
            notify();
        },
        listBrokerages: (opts) => brokerages.list(opts),
        brokerageChoices: () => brokerages.choices(),
        call,
        resetSession: () => transport.resetSession(),
        scopedKey: (name) => keys.scopedKey(name),
        brokerageKey(name, brokerageId) {
            const id = brokerageId ?? brokerages.current;
            if (id === null)
                throw new Error('No brokerage selected');
            return keys.brokerageKey(name, id);
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        dispose() {
            tokens.dispose();
            detachStorage();
            listeners.clear();
        },
    };
}
//# sourceMappingURL=client.js.map