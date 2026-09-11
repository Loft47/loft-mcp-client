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
import { attrs } from './jsonapi.js';
export class IdentityStore {
    keys;
    call;
    /** Keyed by storage key, so switching environment cannot leak an identity. */
    cached = null;
    constructor(opts) {
        this.keys = opts.keys;
        this.call = opts.call;
    }
    get current() {
        let key;
        try {
            key = this.keys.key('identity');
        }
        catch {
            return null; // No environment; nothing can be attributed anyway.
        }
        if (this.cached?.key === key)
            return this.cached.identity;
        const stored = this.keys.readJson('identity', null);
        if (!stored?.sub || !stored?.name)
            return null;
        this.cached = { key, identity: stored };
        return stored;
    }
    async load() {
        const known = this.current;
        if (known)
            return known;
        const claims = attrs(await this.call('GetUserinfo'));
        if (!claims?.sub)
            throw new Error('GetUserinfo returned no subject claim');
        const identity = {
            sub: claims.sub,
            name: claims.name || claims.email || `User ${claims.sub}`,
            email: claims.email ?? null,
            profileId: claims.profileId ?? null,
            profileType: claims.profileType ?? null,
        };
        this.cached = { key: this.keys.key('identity'), identity };
        this.keys.writeJson('identity', identity);
        return identity;
    }
    clear() {
        this.cached = null;
        try {
            this.keys.remove('identity');
        }
        catch {
            // No environment selected; nothing stored.
        }
    }
}
//# sourceMappingURL=identity.js.map