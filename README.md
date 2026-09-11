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

## Build one by asking

You do not have to write the wiring yourself. Point Claude at this repo and
describe the tool your brokerage actually needs:

> Use https://github.com/Loft47/loft-mcp-client to create a new standalone
> React + Vite app that …

### Two that already exist

Both run on this client, and both are worth reading before you prompt.

| App | What it does |
| --- | --- |
| [`Loft47/audit-commission`](https://github.com/Loft47/audit-commission) | Read-only pre-payout audit. Runs a configurable rule set over a payout cycle — gross commission that does not match the plan rate, payout components that do not sum to the total, deals closed and commissionable with nothing paid, a referral source recorded with no referral fee carved out — and keeps an attributable trail of who cleared what and why. |
| [`Loft47/comply-dashboard`](https://github.com/Loft47/comply-dashboard) | Live compliance board. Deal status, outstanding requirements, FINTRAC client risk scoring and the deals that need a managing broker's review. |

### Prompts worth stealing

One paste into Claude each. Say which environment to start in — `staging`,
always, until you trust it.

#### Money, commissions and payouts

**💵 Commission & deduction detective**

> Use https://github.com/Loft47/loft-mcp-client to build a standalone app that
> explains any agent's payout. Take a deal and an agent, then walk the whole
> chain — gross commission, the split that applied, every deduction and cap
> contribution, tax, advances recovered — and show me line by line why the
> number came out the way it did. I need to answer "why is my cheque short"
> without opening five screens.

**💰 Payout readiness**

> Use https://github.com/Loft47/loft-mcp-client to build a standalone app that
> answers one question per agent: ready for payout, or not. Check commissions
> calculated, deductions applied, advances outstanding, requirements satisfied
> and trust balances sufficient. Show a Ready / Not Ready badge with the
> specific blockers listed underneath, and let me sort by amount waiting.

**🧾 Agent receivables aging**

> Use https://github.com/Loft47/loft-mcp-client to build a standalone app that
> ages unpaid agent deductions into 0–30 / 31–60 / 61–90 / 90+ buckets, totals
> per agent, and flags anyone whose balance is larger than the commission left
> on their unclosed deals.

**📆 Commission cash-flow forecast**

> Use https://github.com/Loft47/loft-mcp-client to build a standalone app that
> forecasts brokerage income by month — firm-but-unclosed deals bucketed by
> expected close date, with a running 90-day total against the last three
> months actual.

#### Compliance and deal flow

**🛡️ FINTRAC risk detective**

> Use https://github.com/Loft47/loft-mcp-client to build a standalone app that
> surfaces FINTRAC exposure. Missing identification requirements, Receipt of
> Funds not on file, transactions that score high risk — ranked by how close the
> deal is to closing, with an alert list for the managing broker.

**🤖 Convey OP copilot**

> Use https://github.com/Loft47/loft-mcp-client to build a standalone app that
> moves deals toward Convey Ready and Ready for Payout. Show the outstanding
> requirements per deal, who owns each one, how long it has been sitting, and
> draft the follow-up email to the agent so I only have to press send.

**📋 Deal file completeness**

> Use https://github.com/Loft47/loft-mcp-client to build a standalone app that
> shows, for every deal closing in the next 30 days, which requirements are
> still outstanding. Group by agent, show days to close, and let me mark a deal
> as chased so I know who I have already emailed.

**💧 Missing deposits and trust shortfalls**

> Use https://github.com/Loft47/loft-mcp-client to build a standalone app that
> lists every deal where the money is not where it should be — a firm deal with
> a deposit still outstanding, a trust balance that does not cover what is owed
> out of it, a closed deal with a payout remaining. Worst first, deep-linked
> back into Loft47.

#### Growth, people and operations

**📈 Referral and lead intelligence**

> Use https://github.com/Loft47/loft-mcp-client to build a standalone app that
> shows where our business actually comes from. Break deal count and GCI down by
> lead source, referral partner, tag, agent and office, compare against the same
> period last year, and tell me which sources are growing and which are dead.

**🏆 Agent production leaderboard**

> Use https://github.com/Loft47/loft-mcp-client to build a standalone app that
> ranks agents by year-to-date production — deal count, gross commission,
> brokerage net, average sale price — switchable between closed and firm,
> filterable by office and team, and exportable.

**👋 Recruiting and retention watch**

> Use https://github.com/Loft47/loft-mcp-client to build a standalone app that
> shows me agents who have gone quiet — no new deal written in 60, 90 or 180
> days — next to their production over the same period last year, so I can see
> who is slipping before they leave.

**📇 Agent roster export**

> Use https://github.com/Loft47/loft-mcp-client to build a standalone app that
> exports our agent roster to CSV — name, email, phone, office, team, status,
> start date — filterable to active only and by office, with a column layout I
> can save. For board dues, E&O renewal and reconciling the MLS roster.

**🤝 Co-op and outside brokerage reconciliation**

> Use https://github.com/Loft47/loft-mcp-client to build a standalone app that
> lists every deal with an outside brokerage on it: the co-op side, what we owe
> or are owed, whether the external payout has been transacted, and anything
> outstanding more than 14 days past close.

### What to expect

Claude installs the client, sets up the dev proxy, renders the seven gates and
writes the tool wrappers. What is left is the part only you know — your rules.

Two things to be honest with yourself about before prompting:

**The tool set is whatever your MCP server exposes.** The two sample apps use a
read-only subset — `ListDeals`, `GetDealFinancials`, `ListDealPayouts`,
`ListDealRequirements`, `ListProfiles`, `ListTeams`, `ListCommissions`,
`ListAllocations`, `ListDealAccessDeductions`, `ListDeductionTemplates`,
`GetBrokerage`. Anything above that leans on accounting, support tickets or
setup data needs tools this client cannot invent; `call` reaches whatever is
there, and nothing more. Ask Claude to confirm the tools exist before it builds
a screen around them.

**Anything that fixes, relinks, re-runs or sends needs a write tool.** Where
there is none, the honest version of that app is one that finds the problem,
explains it and hands you the link. That is still most of the value.

Otherwise: a browser client, so no server to stand up and no database. Sign-in
is OAuth against your real account, so an app only ever sees the brokerages you
could already reach.

Start on `staging`. The environment picker is the first gate for a reason.

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
