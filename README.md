# Loft47 MCP Client

"A workflow for every brokerage is a workflow for no one."

## Library Overview

Real estate brokerages are like snowflakes—if snowflakes were obsessed with multi-tiered commission splits, hyper-specific transaction pipelines, and proprietary deal structures. Traditional software loves forcing every team into the same rigid box, usually resulting in Frankenstein spreadsheets, manual workarounds, and unnecessary friction just to run daily operations.

This Loft47 MCP library was built on a simple premise: your software should bend to your operational logic, not the other way around.

By exposing Loft47's backend capabilities directly to your AI agents through the Model Context Protocol, this library lets you query, automate, and orchestrate brokerage operations tailored precisely to how your business actually runs. Whether you're managing a boutique luxury firm with custom split rules or a high-volume team with specialized closing workflows, this tool gives your language models the context needed to work inside your system, your way.

Stop compromising your process to fit your tools!  Start prompting your backend on your own terms.

## What it does

Headless browser client for the Loft47 MCP server. It owns the connection —
OAuth PKCE, environment choice, transport, identity, the default brokerage,
automatic token renewal and revocation — so an app writes only its own tool
wrappers.

No runtime dependencies. React is an optional peer.

## Install

```bash
npm install github:Loft47/loft-mcp-client#v0.1.0
```

npm pins a git dependency to a commit SHA in `package-lock.json`, so installs
are reproducible without a registry.

## Use

Create the client once, at module scope:

```ts
// src/loft.ts
import { createLoftMcpClient } from 'loft-mcp-client'

export const loft = createLoftMcpClient({
  appName: 'Commission Audit',
  storagePrefix: 'commission_audit',
  appVersion: '0.1.0',
  redirectUri: import.meta.env.VITE_REDIRECT_URI,
})
```

`storagePrefix` is required: two apps on one origin have nothing else keeping
their sessions apart.

```tsx
import { LoftMcpProvider, useLoftMcp } from 'loft-mcp-client/react'
import { loft } from './loft'

export default function App() {
  return (
    <LoftMcpProvider client={loft}>
      <Gates />
    </LoftMcpProvider>
  )
}

function Gates() {
  const { status, error, retry, setEnvironment, signIn, brokerages, chooseBrokerage } = useLoftMcp()

  if (status === 'error') return <YourError message={error} onRetry={retry} />
  if (status === 'choose-environment') return <YourEnvironmentPicker onPick={setEnvironment} />
  if (status === 'connect') return <YourConnectScreen onConnect={signIn} />
  if (status === 'connecting' || status === 'identifying') return <YourSpinner />
  if (status === 'choose-brokerage') return <YourBrokeragePicker rows={brokerages} onPick={chooseBrokerage} />
  return <YourApp />
}
```

The library ships no markup and no CSS. Those seven statuses are the gates; the
screens are yours. `status === 'error'` must get its own branch — falling
through to `<YourApp />` renders the app over a session that never finished
connecting.

The provider takes one option of its own: `autoSelectSingle` (default `true`)
skips the brokerage picker when the account can reach exactly one brokerage.
Pass `autoSelectSingle={false}` to always show it.

## Without React

React is optional, and nothing in the core needs it. The same flow by hand:

```ts
import { createLoftMcpClient } from 'loft-mcp-client'

const loft = createLoftMcpClient({ appName: 'Commission Audit', storagePrefix: 'commission_audit' })

// Re-render on every state change: environment, auth, identity, brokerage.
const unsubscribe = loft.subscribe(render)

async function connect() {
  // 1. An environment must be chosen before anything else. It is persisted, so
  //    it survives the round trip through the authorization server.
  if (!loft.environment) loft.setEnvironment('staging')

  // 2. Coming back from the redirect? Finish. Otherwise start it — `signIn()`
  //    navigates away, so nothing after it runs.
  const code = new URLSearchParams(window.location.search).get('code')
  if (code) {
    await loft.completeSignIn(code)
    window.history.replaceState({}, '', window.location.pathname)
  } else if (!loft.isAuthenticated) {
    return loft.signIn()
  }

  // 3. Who is signed in, and which brokerage are we working in?
  const me = await loft.loadIdentity()
  console.log(`Signed in as ${me.name}`)

  if (loft.brokerageId === null) {
    const choices = await loft.brokerageChoices()
    if (choices.length === 1) loft.setBrokerage(choices[0].id)
  }

  // 4. Call anything the server exposes.
  return loft.call('ListDeals', { brokerage_id: loft.brokerageId })
}
```

Call `unsubscribe()` when the listener goes away, and `loft.dispose()` when the
client does — it stops the renewal timer and detaches the cross-tab listeners.

Two typed errors are worth branching on, both exported from the package root:

| Error | Means |
| --- | --- |
| `NoEnvironmentError` | Nothing chosen yet. Render the environment picker, not an error. |
| `AuthExpiredError` | Credentials are permanently gone. Render the connect screen. |

A transient failure (network, 5xx, 429) is a plain `Error` and leaves the
session intact — retry it.

## Your own tool wrappers

Domain tools are deliberately out of scope. Write them against `call`:

```ts
import { loft } from './loft'
import type { Doc } from 'loft-mcp-client'

interface DealAttrs { id: number; dealNumber: number | null /* … */ }

export const listDeals = (brokerageId: number, filters = {}) =>
  loft.call<Doc<DealAttrs>>('ListDeals', { brokerage_id: brokerageId, ...filters })
```

JSON:API helpers come with the package: `list`, `one`, `attrs`, `relId`,
`relIds`, `includedIndex`, `findIncluded`, and Loft47 value parsers `toCents`,
`centsOr0`, `toNumber`, `toDate`.

`toCents` exists because Loft47 returns the same money field as a decimal string
on one record and a bare number on another. Compare money in integer cents.

## API reference

### `createLoftMcpClient(options)`

| Option | Default | What it is for |
| --- | --- | --- |
| `appName` | — | **Required.** OAuth `client_name` and the MCP `clientInfo.name`. |
| `storagePrefix` | — | **Required.** Namespaces every key. Two apps on one origin have nothing else keeping their sessions apart. |
| `appVersion` | `'0.0.0'` | MCP `clientInfo.version`. |
| `redirectUri` | `window.location.origin` | Where the authorization server sends the browser back. Must match the dev server's port exactly. |
| `environments` | `LOFT_ENVIRONMENTS` | Override to add a local server. See [Environments](#environments). |
| `storage` | `window.localStorage` | Any `StorageLike`. Injected in tests; also the hook for a non-browser host. |
| `sessionStore` | `window.sessionStorage` | Where the PKCE verifier lives, deliberately apart from `storage`. |
| `navigate` | sets `window.location.href` | How the top-level navigation to `authorize` happens. |
| `baseUrl` | `(env) => env.proxyPrefix` | Where `fetch` goes. Point it at your reverse proxy for a deployed build. |
| `maxConcurrent` | `6` | Cap on simultaneous requests to `/mcp`. |
| `defaultTokenTtlSeconds` | `1800` | Last resort when neither `expires_in` nor an `exp` claim is available. |
| `refreshSkewSeconds` | `120` | How far ahead of expiry the renewal timer and the pre-flight fire. |
| `onAuthExpired` | — | Called once when credentials are permanently gone. Not called for a transient failure. |
| `onStorageError` | — | Called when a mirror write to storage throws (quota, private mode). The session keeps working from memory. |
| `fetchImpl` | `globalThis.fetch` | Injected in tests. |

### The client

| Member | What it does |
| --- | --- |
| `environments` | The registry as an array, for a picker. |
| `environment` | The selected one, or `null`. Never throws. |
| `setEnvironment(id)` | Chooses one and adopts its stored session. Throws on an id outside the registry. |
| `clearEnvironment()` | Deselects. Credentials for that environment survive — use `revoke()` to drop them. |
| `isAuthenticated` | Whether a token is stored. Synchronous. |
| `signIn()` | Registers a client, mints PKCE and navigates away. Nothing after it runs. |
| `completeSignIn(code)` | Exchanges the `?code=` from the redirect and stores the tokens. |
| `getAccessToken()` | A token guaranteed fresh, renewing first if needed. |
| `revoke(opts?)` | See [Revocation](#revocation). |
| `identity` | Who is signed in, or `null`. Synchronous, so it can stamp an actor inside an event handler. |
| `loadIdentity()` | Resolves `identity`, from cache or `GetUserinfo`. |
| `brokerageId` | The remembered brokerage for this environment, or `null`. |
| `setBrokerage(id)` / `clearBrokerage()` | Set or forget it. Remembered per environment. |
| `listBrokerages(opts?)` | The raw JSON:API document. |
| `brokerageChoices()` | The same list flattened and sorted, for a picker. |
| `call(name, args?)` | Any tool the server exposes. Identical concurrent calls share one request. |
| `resetSession()` | Drops the MCP session id, forcing a fresh handshake. Credentials untouched. |
| `scopedKey(name)` / `brokerageKey(name, id?)` | Namespace your own storage exactly the way the library does. |
| `subscribe(listener)` | Fires on environment, auth, identity and brokerage changes. Returns an unsubscribe. |
| `dispose()` | Stops the renewal timer, detaches the cross-tab listeners, drops subscribers. |

### `useLoftMcp()`

Everything the gates need, plus an escape hatch to the client itself.

| Field | What it is |
| --- | --- |
| `status` | One of the seven gates above. |
| `error` | The message behind `status === 'error'`, or `null`. |
| `retry` | Clears the error and lets the failed step run again. |
| `environments` / `environment` | The registry, and the current choice. |
| `setEnvironment(id)` | Chooses one and resets the provider's own cached state. |
| `switchEnvironment()` | Back to the picker, keeping this environment's credentials. |
| `signIn()` | Starts the OAuth redirect. |
| `identity` | Who is signed in, or `null`. |
| `brokerageId` | The current brokerage, or `null`. |
| `brokerages` | The choices, or `null` until loaded. Sorted by name. |
| `chooseBrokerage(id)` | Picks one. |
| `switchBrokerage()` | Back to the brokerage picker. |
| `revoke(opts?)` | `client.revoke`, plus clearing the provider's cached choices. |
| `call` | `client.call`. |
| `client` | The client itself, for anything not surfaced here. |

The provider completes the OAuth redirect, loads identity and fetches the
brokerage choices on its own — a consumer renders gates and calls tools.

## Dev server proxy

The MCP hosts send no CORS headers, so browser requests go through a
same-origin prefix:

```ts
// vite.config.ts
import { loftMcpProxy } from 'loft-mcp-client/vite'

export default defineConfig({
  server: { port: 5173, strictPort: true, proxy: { ...loftMcpProxy() } },
  preview: { proxy: { ...loftMcpProxy() } },
})
```

`strictPort` matters: the registered OAuth `redirect_uri` is bound to the port,
so silently moving to 5174 breaks sign-in in a way that is hard to diagnose.

**A proxy is a dev-server feature.** A static production build has none, so a
deployed app needs CORS on the MCP server or its own reverse proxy — point the
`baseUrl` option at it:

```ts
createLoftMcpClient({ /* … */ baseUrl: (env) => `/upstream/${env.id}` })
```

## Token renewal

Three triggers keep the access token fresh, because none is enough alone:

| Trigger | When |
| --- | --- |
| Timer | `expiresAt − refreshSkewSeconds` (default 120s) |
| Pre-flight | before every request — this is the guarantee |
| 401 | after the fact, for clock skew and revocation |

Refresh is single-flight: concurrent callers share one request, so a server
that rotates refresh tokens never sees a stale one.

Expiry comes from `expires_in`, else the access token's `exp` claim, else
`defaultTokenTtlSeconds` (1800).

A **transient** failure (network, 5xx, 429) keeps the session and retries on the
next call. A **permanent** one (`invalid_grant`) clears credentials, calls
`onAuthExpired` and throws `AuthExpiredError` — but keeps the environment and
brokerage, so the user returns to the connect screen for the right environment.

## Revocation

```ts
loft.revoke()                 // credentials, identity, session, environment, brokerage
loft.revoke({ purge: true })  // all of that plus every key under storagePrefix
```

The default spares your app's own state. Use `purge` only when you mean it —
for a consuming app that is its data.

**`revoke()` is local only — it is not a security boundary.** The MCP server
advertises a `revocation_endpoint` (RFC 7009) and this library does not call
it, so the refresh token stays valid server-side until it expires on its own.
What `revoke()` guarantees is that this browser no longer holds usable
credentials. If you need the grant genuinely killed at the server, that is a
follow-up this library does not cover today.

Namespace your own state the same way the library does:

```ts
loft.scopedKey('settings')     // 'commission_audit:staging:settings'
loft.brokerageKey('rules')     // 'commission_audit:staging:45:rules'
```

## Environments

`staging` and `production` ship by default and are hard-isolated: tokens, the
registered client, the MCP session, identity and the brokerage default are all
namespaced by environment. "Brokerage 45" is a different company in each.

Override the registry to add a local server:

```ts
createLoftMcpClient({
  environments: {
    ...LOFT_ENVIRONMENTS,
    local: { id: 'local', label: 'Local', description: 'Local Rails',
             mcpHost: 'http://localhost:3000', appBase: 'http://localhost:3000',
             proxyPrefix: '/loft/local' },
  },
})
```

## Development

```bash
npm install
npm test
npm run typecheck
npm run build     # emits dist/, which is committed
npm run dev       # local harness for a real sign-in — see dev/
```

`dist/` is committed, so **rebuild before tagging a release.** CI enforces it.
