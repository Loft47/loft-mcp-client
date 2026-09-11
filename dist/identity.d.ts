/**
 * Who is signed in.
 *
 * The only trustworthy source is the token itself: `GetUserinfo` returns the
 * claims of whoever holds it. Nothing here is user-editable, so an action
 * cannot be attributed to someone else's name.
 *
 * Cached two ways deliberately. The in-memory copy makes `current` synchronous,
 * which callers need when stamping an actor inside a plain event handler. The
 * persisted copy is environment-scoped and survives a reload, so the first
 * action after a refresh does not race the round trip.
 */
import type { KeyStore } from './storage.js';
export interface Identity {
    /** The user id as a string — OIDC's subject identifier. */
    sub: string;
    /** Always non-empty: the name, else the email, else `User <sub>`. */
    name: string;
    email: string | null;
    profileId: number | null;
    /** Agent, Broker, OfficeAdmin, SuperAdmin, … */
    profileType: string | null;
}
export interface UserinfoAttrs {
    sub: string;
    name: string | null;
    email: string | null;
    profileId: number | null;
    profileType: string | null;
}
export interface IdentityStoreOptions {
    keys: KeyStore;
    call: <T>(name: string, args?: Record<string, unknown>) => Promise<T>;
}
export declare class IdentityStore {
    private readonly keys;
    private readonly call;
    /** Keyed by storage key, so switching environment cannot leak an identity. */
    private cached;
    constructor(opts: IdentityStoreOptions);
    get current(): Identity | null;
    load(): Promise<Identity>;
    clear(): void;
}
//# sourceMappingURL=identity.d.ts.map