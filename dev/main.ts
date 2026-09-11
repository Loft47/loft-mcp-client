import { createLoftMcpClient } from '../src/index.js'

const client = createLoftMcpClient({
  appName: 'loft-mcp-client harness',
  storagePrefix: 'loft_mcp_harness',
  appVersion: '0.1.0',
  redirectUri: 'http://localhost:5173',
})

const out = document.querySelector<HTMLPreElement>('#out')!
const controls = document.querySelector<HTMLDivElement>('#controls')!

function button(label: string, onClick: () => void | Promise<void>) {
  const el = document.createElement('button')
  el.textContent = label
  el.onclick = () => void Promise.resolve(onClick()).catch(show).finally(render)
  controls.append(el)
}

function show(value: unknown) {
  out.textContent =
    value instanceof Error ? `${value.name}: ${value.message}` : JSON.stringify(value, null, 2)
}

function render() {
  show({
    status: {
      environment: client.environment?.id ?? null,
      authenticated: client.isAuthenticated,
      identity: client.identity,
      brokerageId: client.brokerageId,
    },
    // The point of this harness: what the token endpoint actually gave us.
    storedExpiresAt: localStorage.getItem(
      client.environment ? `loft_mcp_harness:${client.environment.id}:expires_at` : 'none',
    ),
  })
}

for (const env of client.environments) {
  button(`Use ${env.label}`, () => client.setEnvironment(env.id))
}
button('Sign in', () => client.signIn())
button('Load identity', () => client.loadIdentity())
button('List brokerages', async () => show(await client.brokerageChoices()))
button('Force refresh', async () => show(await client.getAccessToken()))
button('Revoke', () => client.revoke())
button('Revoke + purge', () => client.revoke({ purge: true }))

const code = new URLSearchParams(window.location.search).get('code')
if (code) {
  client
    .completeSignIn(code)
    .then(() => window.history.replaceState({}, '', '/'))
    .catch(show)
    .finally(render)
} else {
  render()
}

client.subscribe(render)
