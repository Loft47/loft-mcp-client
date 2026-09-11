import { createContext, useContext } from 'react';
export const LoftMcpContext = createContext(null);
export function useLoftMcp() {
    const value = useContext(LoftMcpContext);
    if (!value)
        throw new Error('useLoftMcp must be used inside a <LoftMcpProvider>');
    return value;
}
//# sourceMappingURL=useLoftMcp.js.map