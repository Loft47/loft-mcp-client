/**
 * Which brokerage this session is working in, and which ones it may choose from.
 *
 * `ListBrokerages` is scoped to the signed-in user's access, so most accounts
 * see exactly one row. The choice is remembered per environment: "brokerage 45"
 * names different companies in staging and production.
 */
import type { Doc } from './jsonapi.js';
import type { KeyStore } from './storage.js';
export interface BrokerageAttrs {
    id: number;
    name: string;
    legalName: string | null;
    franchiseName: string | null;
    subdomain: string | null;
    inactiveDate: string | null;
    country: string | null;
    currency: string | null;
}
/** A brokerage flattened for a picker. */
export interface BrokerageChoice {
    id: number;
    name: string;
    legalName: string | null;
    franchiseName: string | null;
    country: string | null;
    currency: string | null;
    inactive: boolean;
}
export interface BrokerageStoreOptions {
    keys: KeyStore;
    call: <T>(name: string, args?: Record<string, unknown>) => Promise<T>;
}
export interface ListBrokeragesOptions {
    page_number?: number;
    page_size?: number;
    filter_search?: string;
}
export declare class BrokerageStore {
    private readonly keys;
    private readonly call;
    constructor(opts: BrokerageStoreOptions);
    get current(): number | null;
    set(id: number): void;
    clear(): void;
    /**
     * `include: ''` keeps the payload small — the default include set returns
     * every deduction template and broker on every brokerage, which is megabytes.
     */
    list(opts?: ListBrokeragesOptions): Promise<Doc<BrokerageAttrs>>;
    /** The list flattened and sorted for a picker. */
    choices(): Promise<BrokerageChoice[]>;
}
//# sourceMappingURL=brokerage.d.ts.map