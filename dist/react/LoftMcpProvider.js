import { jsx as _jsx } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AuthExpiredError } from '../errors.js';
import { LoftMcpContext } from './useLoftMcp.js';
const message = (error) => (error instanceof Error ? error.message : String(error));
export function LoftMcpProvider({ client, autoSelectSingle = true, children, }) {
    // The client is mutable and notifies on change; a version bump re-reads it.
    const [, bump] = useReducer((n) => n + 1, 0);
    useEffect(() => client.subscribe(bump), [client]);
    const [error, setError] = useState(null);
    const [exchanging, setExchanging] = useState(false);
    const [brokerages, setBrokerages] = useState(null);
    const exchange = useRef(null);
    // ── Complete the OAuth redirect ───────────────────────────────────────────
    useEffect(() => {
        if (!client.environment || client.isAuthenticated || error)
            return;
        const code = new URLSearchParams(window.location.search).get('code');
        if (!code)
            return;
        // An authorization code is single-use, so the exchange must start at most
        // once. But StrictMode tears this effect down and remounts it while the
        // first request is still open, and a boolean "already did this" latch locks
        // the second pass out of its own completion: the first pass is cancelled,
        // the second never starts, and nothing ever clears `exchanging`. Memoising
        // the promise instead lets the remount re-subscribe to the in-flight
        // exchange rather than re-issuing it.
        if (exchange.current?.code !== code) {
            exchange.current = { code, settled: client.completeSignIn(code) };
        }
        let cancelled = false;
        setExchanging(true);
        exchange.current.settled
            .then(() => {
            // Still guarded, so a genuinely unmounted provider never writes
            // history. A StrictMode remount is not that case: it re-subscribes
            // above, so the live pass scrubs the spent code.
            if (cancelled)
                return;
            window.history.replaceState({}, '', window.location.pathname);
        })
            .catch((err) => {
            if (cancelled)
                return;
            setError(message(err));
        })
            .finally(() => {
            if (cancelled)
                return;
            setExchanging(false);
        });
        return () => {
            cancelled = true;
        };
    }, [client, error]);
    // `client.isAuthenticated` / `client.identity` are live getters, not React
    // state: a subscribe-triggered re-render (e.g. a direct `completeSignIn()`
    // call that bypasses the effect above) changes what these read without
    // changing `client`, `error` or `exchanging` themselves. Recomputing this
    // plain boolean every render and depending on *it* — the same trick
    // `needsBrokerage` below uses — is what lets the effect notice the
    // transition instead of skipping it because its own deps look unchanged.
    const needsIdentity = client.isAuthenticated && !client.identity && !exchanging && !error;
    // ── Resolve who is signed in ──────────────────────────────────────────────
    useEffect(() => {
        if (!needsIdentity)
            return;
        let cancelled = false;
        client.loadIdentity().catch((err) => {
            if (cancelled)
                return;
            // The client has already dropped the credentials and notified; falling
            // back to the connect screen beats stranding a token we cannot identify.
            if (err instanceof AuthExpiredError)
                return;
            setError(message(err));
        });
        return () => {
            cancelled = true;
        };
    }, [client, needsIdentity]);
    const needsBrokerage = Boolean(client.identity) && client.brokerageId === null && !error;
    // ── Load the brokerage choices ────────────────────────────────────────────
    useEffect(() => {
        if (!needsBrokerage || brokerages)
            return;
        let cancelled = false;
        client
            .brokerageChoices()
            .then((rows) => {
            if (cancelled)
                return;
            setBrokerages(rows);
            if (autoSelectSingle && rows.length === 1)
                client.setBrokerage(rows[0].id);
        })
            .catch((err) => {
            if (cancelled)
                return;
            if (err instanceof AuthExpiredError)
                return;
            setError(message(err));
        });
        return () => {
            cancelled = true;
        };
    }, [client, needsBrokerage, brokerages, autoSelectSingle]);
    const status = error
        ? 'error'
        : !client.environment
            ? 'choose-environment'
            : exchanging
                ? 'connecting'
                : !client.isAuthenticated
                    ? 'connect'
                    : !client.identity
                        ? 'identifying'
                        : client.brokerageId === null
                            ? 'choose-brokerage'
                            : 'ready';
    const retry = useCallback(() => {
        exchange.current = null;
        setError(null);
    }, []);
    // Leaves this environment's credentials in place. Keys are namespaced per
    // environment, so nothing leaks, and coming back does not mean signing in
    // again. Use `revoke` for that.
    const switchEnvironment = useCallback(() => {
        setBrokerages(null);
        setError(null);
        client.clearEnvironment();
    }, [client]);
    const switchBrokerage = useCallback(() => {
        setBrokerages(null);
        client.clearBrokerage();
    }, [client]);
    const value = useMemo(() => ({
        client,
        status,
        error,
        environments: client.environments,
        environment: client.environment,
        setEnvironment: (id) => {
            setBrokerages(null);
            setError(null);
            client.setEnvironment(id);
        },
        switchEnvironment,
        signIn: () => client.signIn(),
        identity: client.identity,
        brokerageId: client.brokerageId,
        brokerages,
        chooseBrokerage: (id) => client.setBrokerage(id),
        switchBrokerage,
        revoke: (opts) => {
            setBrokerages(null);
            setError(null);
            client.revoke(opts);
        },
        retry,
        call: client.call,
    }), [client, status, error, brokerages, retry, switchEnvironment, switchBrokerage]);
    return _jsx(LoftMcpContext.Provider, { value: value, children: children });
}
//# sourceMappingURL=LoftMcpProvider.js.map