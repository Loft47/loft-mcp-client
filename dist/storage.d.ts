/**
 * Every key this library reads or writes, and the two ways of removing them.
 *
 * Namespacing is `<prefix>:<environment>:<name>`. Environments are hard-isolated
 * because "brokerage 45" names different companies in staging and production and
 * a staging token must never reach production.
 *
 * Two departures from the code this replaces:
 *
 *  1. There is no `'unset'` fallback. The previous implementation namespaced to
 *     `<prefix>:unset:<name>` before an environment was chosen, which wrote keys
 *     nothing ever read or cleared. Writes now throw; reads return null.
 *  2. Values are held in memory as well as mirrored to storage. A token write
 *     that fails on quota or in private-mode Safari must not leave the user
 *     signed in and instantly signed out; it degrades only across a reload.
 *
 * Reads prefer storage, which is what lets one tab pick up a token another tab
 * refreshed without any message passing. The one exception is a key whose
 * mirror write failed: storage then holds the older value, so memory wins for
 * that key until a write succeeds or another tab writes it. See `dirty`.
 */
export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
    key(index: number): string | null;
    readonly length: number;
}
/**
 * The library's own keys, enumerated so `clearLibraryKeys` can never remove
 * something it does not know about — app state lives under the same prefix.
 * `pkce_verifier` is absent on purpose: it lives in sessionStorage.
 */
export declare const LIBRARY_KEY_NAMES: readonly ["token", "refresh_token", "expires_at", "client_id", "redirect_uri", "mcp_session", "identity", "brokerage_id"];
export interface KeyStoreOptions {
    prefix: string;
    storage: StorageLike;
    session: StorageLike;
    onStorageError?: (error: unknown) => void;
}
export declare class KeyStore {
    private readonly prefix;
    private readonly storage;
    private readonly session;
    private readonly onStorageError;
    /** Source of truth when a mirror write has failed. */
    private readonly memory;
    /**
     * Keys whose last mirror write threw, so storage still holds a value this
     * object knows to be stale. Storage normally wins a read — that is what lets
     * one tab adopt another's newer token without any message passing — but for
     * exactly these keys it holds the *older* value and memory must win.
     *
     * Without this, an overwrite that fails on quota (a token being renewed into
     * a full store) leaves the previous token in storage and the new one
     * unreachable: every request re-reads the dead token, re-POSTs the token
     * endpoint, and re-presents a refresh token the server may already have
     * rotated. A key absent from storage never showed the bug, which is why only
     * that case had a test.
     */
    private readonly dirty;
    constructor(opts: KeyStoreOptions);
    /** Not environment-namespaced: this key *is* the environment choice. */
    private get environmentKey();
    get environmentId(): string | null;
    setEnvironmentId(id: string): void;
    clearEnvironmentId(): void;
    /** Throws when no environment is selected, rather than inventing a namespace. */
    key(name: string): string;
    /** Alias of `key`, exposed so consumers can namespace their own state identically. */
    scopedKey(name: string): string;
    brokerageKey(name: string, brokerageId: number): string;
    read(name: string): string | null;
    write(name: string, value: string): void;
    remove(name: string): void;
    readJson<T>(name: string, fallback: T): T;
    writeJson(name: string, value: unknown): void;
    readSession(name: string): string | null;
    writeSession(name: string, value: string): void;
    removeSession(name: string): void;
    /** Spec §7: library keys only. App state and the environment choice survive. */
    clearLibraryKeys(): void;
    /** Spec §7: everything under this prefix, in both storages, app state included. */
    purge(): void;
    /**
     * Storage first, so a value another tab wrote is picked up for free — except
     * for a key this object failed to mirror, where storage is known-stale.
     */
    private pick;
    private put;
    private drop;
    /**
     * Another tab writing a key makes storage authoritative for it again, so the
     * stale-mirror flag is dropped. Only the flag: the in-memory copy stays as
     * the fallback for when storage has nothing to offer.
     *
     * A null `key` means storage was cleared wholesale; every flag goes.
     */
    attachStorageListener(target?: EventTarget): () => void;
}
//# sourceMappingURL=storage.d.ts.map