import type { LoftMcpClient } from '../client.js';
export interface LoftMcpProviderProps {
    /**
     * Create this once at module scope, not in a component body: StrictMode
     * double-invokes renders, which would register two OAuth clients and arm two
     * renewal timers.
     */
    client: LoftMcpClient;
    /** Skip the picker when the account can reach exactly one brokerage. */
    autoSelectSingle?: boolean;
    children: React.ReactNode;
}
export declare function LoftMcpProvider({ client, autoSelectSingle, children, }: LoftMcpProviderProps): import("react").JSX.Element;
//# sourceMappingURL=LoftMcpProvider.d.ts.map