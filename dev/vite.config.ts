import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import { loftMcpProxy } from '../src/vite/index.js'

/**
 * Harness for exercising the library against a real Loft47 MCP server. Not
 * shipped — `files` in package.json is `["dist"]`.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: {
    port: 5173,
    // The registered OAuth redirect_uri is bound to this port.
    strictPort: true,
    proxy: { ...loftMcpProxy() },
  },
})
