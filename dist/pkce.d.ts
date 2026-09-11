/** PKCE (RFC 7636) helpers. Uses WebCrypto, so browser or Node 18+ only. */
export declare function base64url(bytes: Uint8Array): string;
/** 32 bytes base64url-encodes to 43 characters, inside RFC 7636's 43–128 range. */
export declare function randomVerifier(byteCount?: number): string;
export declare function challengeFor(verifier: string): Promise<string>;
//# sourceMappingURL=pkce.d.ts.map