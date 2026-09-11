export interface MockCall {
  url: string
  method: string
  headers: Record<string, string>
  body: string | null
}

export interface MockResponse {
  status?: number
  json?: unknown
  text?: string
  headers?: Record<string, string>
  /** When set, the fetch rejects instead of responding — the network-error path. */
  networkError?: string
}

type Matcher = string | RegExp
type Responder = MockResponse | ((call: MockCall) => MockResponse)

/**
 * A scripted `fetch`. Routes match on substring or regex against the URL, most
 * recently registered first, so a test can override a default set up in `beforeEach`.
 * Node 18+ provides a real global `Response`, so callers get real `.json()`,
 * `.status`, `.ok` and `.headers.get()` semantics rather than a hand-rolled fake.
 */
export function fetchMock() {
  const calls: MockCall[] = []
  const routes: Array<{ matcher: Matcher; responder: Responder }> = []

  const matches = (matcher: Matcher, url: string) =>
    typeof matcher === 'string' ? url.includes(matcher) : matcher.test(url)

  const impl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString()
    const call: MockCall = {
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      headers: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      ),
      body: typeof init?.body === 'string' ? init.body : null,
    }
    calls.push(call)

    const route = [...routes].reverse().find((r) => matches(r.matcher, url))
    if (!route) throw new Error(`fetchMock: no route for ${call.method} ${url}`)

    const spec = typeof route.responder === 'function' ? route.responder(call) : route.responder
    if (spec.networkError) throw new TypeError(spec.networkError)

    const body =
      spec.json !== undefined ? JSON.stringify(spec.json) : (spec.text ?? '')
    const headers: Record<string, string> = {
      'Content-Type': spec.json !== undefined ? 'application/json' : 'text/plain',
      ...spec.headers,
    }
    return new Response(body, { status: spec.status ?? 200, headers })
  }) as typeof fetch

  return {
    impl,
    calls,
    on(matcher: Matcher, responder: Responder) {
      routes.push({ matcher, responder })
      return this
    },
    callsTo(matcher: Matcher) {
      return calls.filter((c) => matches(matcher, c.url))
    },
  }
}
