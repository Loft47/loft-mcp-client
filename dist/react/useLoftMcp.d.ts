import type { LoftMcpClient } from '../client.js';
import type { BrokerageChoice } from '../brokerage.js';
import type { LoftEnvironment } from '../environments.js';
import type { Identity } from '../identity.js';
/**
 * The gates an app has to render, in the order they are reached. These are not
 * invented: they are the conditions any consumer of this library ends up
 * hand-rolling in its root component.
 */
export type LoftMcpStatus = 'choose-environment' | 'connect' | 'connecting' | 'identifying' | 'choose-brokerage' | 'ready' | 'error';
export interface LoftMcpValue {
    client: LoftMcpClient;
    status: LoftMcpStatus;
    error: string | null;
    environments: LoftEnvironment[];
    environment: LoftEnvironment | null;
    setEnvironment: (id: string) => void;
    switchEnvironment: () => void;
    signIn: () => Promise<void>;
    identity: Identity | null;
    brokerageId: number | null;
    /** Null until loaded. Sorted by name. */
    brokerages: BrokerageChoice[] | null;
    chooseBrokerage: (id: number) => void;
    switchBrokerage: () => void;
    revoke: (opts?: {
        purge?: boolean;
    }) => void;
    /** Clears the error and lets the failed step run again. */
    retry: () => void;
    call: LoftMcpClient['call'];
}
export declare const LoftMcpContext: import("react").Context<LoftMcpValue | null>;
export declare function useLoftMcp(): LoftMcpValue;
//# sourceMappingURL=useLoftMcp.d.ts.map