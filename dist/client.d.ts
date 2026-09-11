/**
 * The one object an app holds.
 *
 * Everything is instance state rather than module state: `storage`, `navigate`
 * and `fetch` are injectable, two clients can coexist, and nothing leaks
 * between tests.
 */
import type { BrokerageAttrs, BrokerageChoice, ListBrokeragesOptions } from './brokerage.js';
import type { Doc } from './jsonapi.js';
import type { EnvId, LoftEnvironment } from './environments.js';
import type { Identity } from './identity.js';
import type { StorageLike } from './storage.js';
export interface LoftMcpClientOptions {
    /** OAuth `client_name` and the MCP `clientInfo.name`. */
    appName: string;
    /** Required: two apps on one origin have nothing else keeping them apart. */
    storagePrefix: string;
    appVersion?: string;
    redirectUri?: string;
    environments?: Record<string, LoftEnvironment>;
    storage?: StorageLike;
    sessionStore?: StorageLike;
    navigate?: (url: string) => void;
    /** Where `fetch` goes. Defaults to the environment's dev-server proxy prefix. */
    baseUrl?: (env: LoftEnvironment) => string;
    maxConcurrent?: number;
    defaultTokenTtlSeconds?: number;
    refreshSkewSeconds?: number;
    onAuthExpired?: () => void;
    onStorageError?: (error: unknown) => void;
    fetchImpl?: typeof fetch;
}
export interface LoftMcpClient {
    readonly environments: LoftEnvironment[];
    readonly environment: LoftEnvironment | null;
    setEnvironment(id: EnvId): void;
    clearEnvironment(): void;
    readonly isAuthenticated: boolean;
    signIn(): Promise<void>;
    completeSignIn(code: string): Promise<void>;
    getAccessToken(): Promise<string>;
    revoke(opts?: {
        purge?: boolean;
    }): void;
    readonly identity: Identity | null;
    loadIdentity(): Promise<Identity>;
    readonly brokerageId: number | null;
    setBrokerage(id: number): void;
    clearBrokerage(): void;
    listBrokerages(opts?: ListBrokeragesOptions): Promise<Doc<BrokerageAttrs>>;
    brokerageChoices(): Promise<BrokerageChoice[]>;
    call<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
    resetSession(): void;
    scopedKey(name: string): string;
    brokerageKey(name: string, brokerageId?: number): string;
    subscribe(listener: () => void): () => void;
    dispose(): void;
}
export declare function createLoftMcpClient(options: LoftMcpClientOptions): LoftMcpClient;
//# sourceMappingURL=client.d.ts.map