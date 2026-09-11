/**
 * Which brokerage this session is working in, and which ones it may choose from.
 *
 * `ListBrokerages` is scoped to the signed-in user's access, so most accounts
 * see exactly one row. The choice is remembered per environment: "brokerage 45"
 * names different companies in staging and production.
 */
import { list } from './jsonapi.js';
export class BrokerageStore {
    keys;
    call;
    constructor(opts) {
        this.keys = opts.keys;
        this.call = opts.call;
    }
    get current() {
        const stored = this.keys.read('brokerage_id');
        if (stored === null)
            return null;
        const id = Number(stored);
        return Number.isFinite(id) ? id : null;
    }
    set(id) {
        this.keys.write('brokerage_id', String(id));
    }
    clear() {
        try {
            this.keys.remove('brokerage_id');
        }
        catch {
            // No environment selected; nothing stored.
        }
    }
    /**
     * `include: ''` keeps the payload small — the default include set returns
     * every deduction template and broker on every brokerage, which is megabytes.
     */
    list(opts = {}) {
        return this.call('ListBrokerages', {
            include: '',
            page_size: 100,
            ...opts,
        });
    }
    /** The list flattened and sorted for a picker. */
    async choices() {
        const doc = await this.list();
        return list(doc)
            .map((resource) => ({
            id: resource.attributes.id,
            name: resource.attributes.name,
            legalName: resource.attributes.legalName,
            franchiseName: resource.attributes.franchiseName,
            country: resource.attributes.country,
            currency: resource.attributes.currency,
            inactive: Boolean(resource.attributes.inactiveDate),
        }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }
}
//# sourceMappingURL=brokerage.js.map