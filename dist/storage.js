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
import { NoEnvironmentError } from './errors.js';
/**
 * The library's own keys, enumerated so `clearLibraryKeys` can never remove
 * something it does not know about — app state lives under the same prefix.
 * `pkce_verifier` is absent on purpose: it lives in sessionStorage.
 */
export const LIBRARY_KEY_NAMES = [
    'token',
    'refresh_token',
    'expires_at',
    'client_id',
    'redirect_uri',
    'mcp_session',
    'identity',
    'brokerage_id',
];
export class KeyStore {
    prefix;
    storage;
    session;
    onStorageError;
    /** Source of truth when a mirror write has failed. */
    memory = new Map();
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
    dirty = new Set();
    constructor(opts) {
        this.prefix = opts.prefix;
        this.storage = opts.storage;
        this.session = opts.session;
        this.onStorageError = opts.onStorageError ?? (() => { });
    }
    // ── Environment ─────────────────────────────────────────────────────────────
    /** Not environment-namespaced: this key *is* the environment choice. */
    get environmentKey() {
        return `${this.prefix}:environment`;
    }
    get environmentId() {
        return this.pick(this.storage, this.environmentKey);
    }
    setEnvironmentId(id) {
        this.put(this.storage, this.environmentKey, id);
    }
    clearEnvironmentId() {
        this.drop(this.storage, this.environmentKey);
    }
    // ── Keys ────────────────────────────────────────────────────────────────────
    /** Throws when no environment is selected, rather than inventing a namespace. */
    key(name) {
        const env = this.environmentId;
        if (!env)
            throw new NoEnvironmentError();
        return `${this.prefix}:${env}:${name}`;
    }
    /** Alias of `key`, exposed so consumers can namespace their own state identically. */
    scopedKey(name) {
        return this.key(name);
    }
    brokerageKey(name, brokerageId) {
        return this.key(`${brokerageId}:${name}`);
    }
    // ── Reads and writes ────────────────────────────────────────────────────────
    read(name) {
        const env = this.environmentId;
        if (!env)
            return null;
        return this.pick(this.storage, `${this.prefix}:${env}:${name}`);
    }
    write(name, value) {
        this.put(this.storage, this.key(name), value);
    }
    remove(name) {
        this.drop(this.storage, this.key(name));
    }
    readJson(name, fallback) {
        const raw = this.read(name);
        if (raw === null)
            return fallback;
        try {
            return JSON.parse(raw);
        }
        catch {
            // Corrupt or hand-edited state degrades to the default rather than crashing.
            return fallback;
        }
    }
    writeJson(name, value) {
        this.write(name, JSON.stringify(value));
    }
    readSession(name) {
        const env = this.environmentId;
        if (!env)
            return null;
        return this.pick(this.session, `${this.prefix}:${env}:${name}`);
    }
    writeSession(name, value) {
        this.put(this.session, this.key(name), value);
    }
    removeSession(name) {
        this.drop(this.session, this.key(name));
    }
    // ── Removal ─────────────────────────────────────────────────────────────────
    /** Spec §7: library keys only. App state and the environment choice survive. */
    clearLibraryKeys() {
        if (!this.environmentId)
            return;
        for (const name of LIBRARY_KEY_NAMES)
            this.remove(name);
        this.removeSession('pkce_verifier');
    }
    /** Spec §7: everything under this prefix, in both storages, app state included. */
    purge() {
        for (const store of [this.storage, this.session]) {
            const doomed = [];
            for (let i = 0; i < store.length; i += 1) {
                const key = store.key(i);
                if (key !== null && key.startsWith(`${this.prefix}:`))
                    doomed.push(key);
            }
            for (const key of doomed)
                this.drop(store, key);
        }
        this.drop(this.storage, this.environmentKey);
        this.memory.clear();
        this.dirty.clear();
    }
    // ── Mirroring ───────────────────────────────────────────────────────────────
    /**
     * Storage first, so a value another tab wrote is picked up for free — except
     * for a key this object failed to mirror, where storage is known-stale.
     */
    pick(store, key) {
        if (this.dirty.has(key))
            return this.memory.get(key) ?? null;
        return store.getItem(key) ?? this.memory.get(key) ?? null;
    }
    put(store, key, value) {
        this.memory.set(key, value);
        try {
            store.setItem(key, value);
            this.dirty.delete(key);
        }
        catch (error) {
            // Quota exhausted, or private-mode storage. Keep serving from memory so
            // the session works; it will not survive a reload.
            this.dirty.add(key);
            this.onStorageError(error);
        }
    }
    drop(store, key) {
        this.memory.delete(key);
        try {
            store.removeItem(key);
            this.dirty.delete(key);
        }
        catch (error) {
            // The removal failed, so storage still holds the old value while this
            // object considers the key gone. Same inversion, same fix.
            this.dirty.add(key);
            this.onStorageError(error);
        }
    }
    /**
     * Another tab writing a key makes storage authoritative for it again, so the
     * stale-mirror flag is dropped. Only the flag: the in-memory copy stays as
     * the fallback for when storage has nothing to offer.
     *
     * A null `key` means storage was cleared wholesale; every flag goes.
     */
    attachStorageListener(target = window) {
        const handler = (event) => {
            const key = event.key;
            if (key === null)
                this.dirty.clear();
            else
                this.dirty.delete(key);
        };
        target.addEventListener('storage', handler);
        return () => target.removeEventListener('storage', handler);
    }
}
//# sourceMappingURL=storage.js.map