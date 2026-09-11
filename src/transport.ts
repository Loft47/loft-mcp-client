/**
 * JSON-RPC 2.0 over HTTP to the MCP server.
 *
 * Requests go to a same-origin path, because the MCP hosts send no CORS headers
 * and a direct browser call is blocked. The server may answer as JSON or as an
 * SSE stream, so both are handled.
 *
 * A single screen can fan out to several calls per record across a hundred or
 * more records, so this module also de-duplicates identical in-flight requests
 * and caps concurrency. Without both, the browser queues hundreds of sockets and
 * the run crawls.
 */

import { AuthExpiredError } from './errors.js'
import type { KeyStore } from './storage.js'

export interface TransportOptions {
  keys: KeyStore
  /** Same-origin URL of the MCP endpoint for the active environment. */
  endpoint: () => string
  getAccessToken: () => Promise<string>
  /**
   * Renews unconditionally when `knownBadToken` is the token still on record —
   * the transport passes the exact token the server 401'd, so a renewal is not
   * skipped just because that token still looks fresh locally.
   */
  forceRefresh: (knownBadToken: string) => Promise<string>
  onAuthExpired: () => void
  clientInfo: { name: string; version: string }
  /** Keep this modest; the API is not built for a wide fan-out. */
  maxConcurrent?: number
  fetchImpl?: typeof fetch
}

interface RpcEnvelope {
  error?: { code?: number; message?: string }
  result?: { isError?: boolean; content?: Array<{ text?: string }> }
}

export class Transport {
  private readonly keys: KeyStore
  private readonly endpoint: () => string
  private readonly getAccessToken: () => Promise<string>
  private readonly forceRefresh: (knownBadToken: string) => Promise<string>
  private readonly onAuthExpired: () => void
  private readonly clientInfo: { name: string; version: string }
  private readonly maxConcurrent: number
  private readonly fetchImpl: typeof fetch

  private sessionId: string | null = null
  private initialized = false
  private initInFlight: Promise<void> | null = null
  private requestId = 1

  private active = 0
  private readonly waiting: Array<() => void> = []
  private readonly inflight = new Map<string, Promise<unknown>>()

  constructor(opts: TransportOptions) {
    this.keys = opts.keys
    this.endpoint = opts.endpoint
    this.getAccessToken = opts.getAccessToken
    this.forceRefresh = opts.forceRefresh
    this.onAuthExpired = opts.onAuthExpired
    this.clientInfo = opts.clientInfo
    this.maxConcurrent = opts.maxConcurrent ?? 6
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  /** Adopts this environment's stored session. Call after the environment is set. */
  primeSession(): void {
    this.sessionId = this.keys.read('mcp_session')
    this.initialized = this.sessionId !== null
  }

  resetSession(): void {
    this.sessionId = null
    this.initialized = false
    // Drop the latch too, so the next call re-handshakes rather than awaiting
    // a handshake that belonged to the session just discarded.
    this.initInFlight = null
    this.inflight.clear()
    try {
      this.keys.remove('mcp_session')
    } catch {
      // No environment selected; there is nothing stored to remove.
    }
  }

  /**
   * Calls a tool. Identical concurrent calls share one request, which matters
   * when several independent callers want the same record's data.
   */
  call<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const key = `${name}:${JSON.stringify(args)}`
    const existing = this.inflight.get(key)
    if (existing) return existing as Promise<T>

    const attempt = this.callOnce(name, args).finally(() => this.inflight.delete(key))
    this.inflight.set(key, attempt)
    return attempt as Promise<T>
  }

  private async callOnce(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.acquire()
    try {
      await this.ensureInitialized()
      this.requestId += 1
      const envelope = (await this.post(
        {
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { name, arguments: args },
          id: this.requestId,
        },
        { label: name },
      )) as RpcEnvelope

      if (envelope.error) throw new Error(envelope.error.message || `MCP error calling ${name}`)

      const text = envelope.result?.content?.[0]?.text
      if (!text) throw new Error(`MCP returned an empty response for ${name}`)

      // A tool-level failure arrives in-band as `isError` with a plain-text
      // body — an unknown tool, or the upstream status and response. That text
      // is the only description of what broke, so never swallow it.
      if (envelope.result?.isError) throw new Error(`${name} failed — ${truncate(text)}`)

      try {
        return JSON.parse(text)
      } catch {
        throw new Error(`${name} returned a non-JSON response — ${truncate(text)}`)
      }
    } finally {
      this.release()
    }
  }

  /**
   * Single-flight, for the same reason refresh is: `maxConcurrent` is 6, so six
   * cold calls can reach this together. Without coalescing they send six
   * handshakes and strand five server-side sessions, of which only the last
   * `Mcp-Session-Id` is ever used again.
   */
  private ensureInitialized(): Promise<void> {
    if (this.initialized) return Promise.resolve()
    if (this.initInFlight) return this.initInFlight

    const attempt = this.runInitialize().finally(() => {
      this.initInFlight = null
    })
    this.initInFlight = attempt
    return attempt
  }

  private async runInitialize(): Promise<void> {
    await this.post(
      {
        jsonrpc: '2.0',
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: this.clientInfo },
        id: 0,
      },
      { label: 'initialize' },
    )
    this.initialized = true
  }

  /**
   * `ctx.retryAfterToken` is set only on the one retry a 401 earns, and carries
   * the exact token the server rejected. `ctx.label` names the tool (or the
   * handshake) in any error raised from here.
   */
  private async post(
    body: unknown,
    ctx: { label: string; retryAfterToken?: string },
  ): Promise<unknown> {
    // Resolve the endpoint before the token. This is where "an environment is
    // selected" is enforced, and spec §6 promises a typed `NoEnvironmentError`
    // so a caller can tell "nothing chosen yet" from a real failure — reading
    // the token first would find nothing stored and throw `AuthExpiredError`
    // instead, with no request ever made.
    const url = this.endpoint()

    const isRetry = ctx.retryAfterToken !== undefined
    // Pre-flight: renews ahead of expiry so the 401 path stays exceptional.
    const token = isRetry
      ? await this.forceRefreshOrExpire(ctx.retryAfterToken!)
      : await this.getAccessToken()

    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
        ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
      },
      body: JSON.stringify(body),
    })

    if (res.status === 401) {
      if (isRetry) {
        this.resetSession()
        this.onAuthExpired()
        throw new AuthExpiredError()
      }
      // The token that was actually sent — not whatever is stored by the time
      // the retry runs — is what the refresh must be forced against.
      return this.post(body, { label: ctx.label, retryAfterToken: token })
    }

    const returned = res.headers.get('Mcp-Session-Id')
    if (returned && returned !== this.sessionId) {
      this.sessionId = returned
      this.keys.write('mcp_session', returned)
    }

    const contentType = res.headers.get('Content-Type') ?? ''
    if (contentType.includes('text/event-stream')) return parseSse(await res.text())

    // A gateway or an unhandled Rails exception answers `/mcp` with an HTML
    // page and a 5xx. `res.json()` would surface that as a bare
    // "Unexpected token '<'", naming neither the tool nor the status — spec §9
    // asks for the truncated body instead.
    const text = await res.text()
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(
        `${ctx.label} returned a non-JSON HTTP ${res.status} — ${truncate(text)}`,
      )
    }
  }

  /**
   * `forceRefresh` distinguishes a dead grant from a blip: it throws
   * `AuthExpiredError` only when the credentials are permanently gone, and a
   * plain `Error` for anything transient (network error, 5xx, 429) — see
   * `tokens.ts`. Only the former may end the session; a transient failure must
   * propagate untouched, with the session and credentials left intact, so the
   * next call can retry.
   */
  private async forceRefreshOrExpire(knownBadToken: string): Promise<string> {
    try {
      return await this.forceRefresh(knownBadToken)
    } catch (error) {
      if (!(error instanceof AuthExpiredError)) throw error
      this.resetSession()
      this.onAuthExpired()
      throw error
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active += 1
      return
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve))
    this.active += 1
  }

  private release(): void {
    this.active -= 1
    this.waiting.shift()?.()
  }
}

function parseSse(text: string): unknown {
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue
    try {
      return JSON.parse(line.slice(6))
    } catch {
      // Keep scanning: a stream can carry keep-alives and comment frames.
    }
  }
  throw new Error('MCP returned an SSE response with no data frame')
}

/** Server error bodies can be a whole HTML page; keep the useful head of it. */
function truncate(text: string, limit = 300): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}
