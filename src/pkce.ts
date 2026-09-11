/** PKCE (RFC 7636) helpers. Uses WebCrypto, so browser or Node 18+ only. */

export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

/** 32 bytes base64url-encodes to 43 characters, inside RFC 7636's 43–128 range. */
export function randomVerifier(byteCount = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(byteCount)))
}

export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}
