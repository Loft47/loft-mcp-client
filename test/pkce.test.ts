import { describe, expect, it } from 'vitest'
import { base64url, challengeFor, randomVerifier } from '../src/pkce.js'

describe('base64url', () => {
  it('uses the URL-safe alphabet and strips padding', () => {
    // 0xfb 0xff produces '+/' in standard base64, which must become '-_'.
    expect(base64url(new Uint8Array([0xfb, 0xff, 0xbf]))).toBe('-_-_')
  })

  it('never emits +, / or =', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(base64url(crypto.getRandomValues(new Uint8Array(32)))).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })
})

describe('randomVerifier', () => {
  it('produces a 43-character verifier from 32 bytes, per RFC 7636', () => {
    expect(randomVerifier()).toHaveLength(43)
  })

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 100 }, () => randomVerifier()))
    expect(seen.size).toBe(100)
  })
})

describe('challengeFor', () => {
  it('matches the RFC 7636 appendix B test vector', async () => {
    // The RFC's worked example: this exact verifier must yield this challenge.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    await expect(challengeFor(verifier)).resolves.toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('is deterministic', async () => {
    const v = randomVerifier()
    expect(await challengeFor(v)).toBe(await challengeFor(v))
  })
})
