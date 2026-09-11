import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// `new URL('.', import.meta.url)` is unsafe here: jsdom (the test environment)
// installs its own global `URL`, which resolves a relative first argument
// against jsdom's document location instead of treating it as file-relative.
// `fileURLToPath(import.meta.url)` takes a string, never touches that global,
// and resolves correctly.
const here = dirname(fileURLToPath(import.meta.url))
const dist = (path: string) => resolve(here, '..', 'dist', path)

/**
 * These run against committed build output. They are the safety net for the
 * one failure mode of committing `dist/`: shipping a tag whose output does not
 * match its source.
 */
describe('build output', () => {
  const files = [
    'index.js', 'index.d.ts',
    'react/index.js', 'react/index.d.ts',
    'vite/index.js', 'vite/index.d.ts',
  ]

  it.each(files)('emits %s', (file) => {
    expect(existsSync(dist(file))).toBe(true)
  })

  it('matches every exports subpath in package.json', () => {
    const pkg = JSON.parse(readFileSync(resolve(here, '..', 'package.json'), 'utf8'))
    for (const entry of Object.values(pkg.exports as Record<string, Record<string, string>>)) {
      for (const target of Object.values(entry)) {
        expect(existsSync(resolve(here, '..', target))).toBe(true)
      }
    }
  })

  // `dist/**/*.js`, as paths relative to `dist/` (e.g. `client.js`,
  // `react/index.js`), normalized to forward slashes regardless of platform.
  const allJsFiles = () =>
    (readdirSync(dist('.'), { recursive: true }) as string[])
      .filter((entry) => entry.endsWith('.js'))
      .map((entry) => entry.split(sep).join('/'))
      .sort()

  it('emits relative imports with extensions everywhere, so Node can resolve them', () => {
    // A source-level `moduleResolution: "bundler"` extensionless import is not
    // a tsc error; it is emitted verbatim into dist and only breaks under
    // plain Node ESM resolution. Every emitted module has to be checked, not
    // just the three entry points — every entry transitively pulls in the
    // rest of the graph (e.g. `index.js` -> `client.js` -> `auth.js` -> ...).
    const offenders: string[] = []
    for (const file of allJsFiles()) {
      const source = readFileSync(dist(file), 'utf8')
      const bareRelative = source.match(/from ['"]\.\.?\/[^'"]*(?<!\.js)['"]/g)
      if (bareRelative) offenders.push(`${file}: ${bareRelative.join(', ')}`)
    }
    expect(offenders).toEqual([])
  })

  it('keeps React out of every non-react entry point', () => {
    // `index.js` importing react directly is only one way this could break;
    // it also breaks if a module several hops down the core graph (anything
    // outside dist/react/) pulls react in. Check the whole non-react subtree.
    const offenders: string[] = []
    for (const file of allJsFiles()) {
      if (file === 'react' || file.startsWith('react/')) continue
      const source = readFileSync(dist(file), 'utf8')
      // Both `import { x } from 'react'` and a bare side-effect `import 'react'`
      // (no `from` clause) count — either pulls react into the core graph.
      if (/(?:from|import) ['"]react(\/[^'"]*)?['"]/.test(source)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })

  it('keeps browser globals out of the vite entry point', () => {
    const source = readFileSync(dist('vite/index.js'), 'utf8')
    expect(source).not.toMatch(/\bwindow\b/)
    expect(source).not.toMatch(/\blocalStorage\b/)
  })
})
