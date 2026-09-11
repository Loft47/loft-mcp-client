/**
 * The two conditions a caller must be able to branch on without matching
 * message text.
 */
/**
 * Credentials are gone and cannot be recovered without a fresh sign-in.
 * Thrown only for a permanent failure — never for a network blip. See spec §6.
 */
export declare class AuthExpiredError extends Error {
    constructor(message?: string);
}
/**
 * Something that needs an environment ran before one was chosen. Distinct from
 * a real failure so a UI can render its environment picker rather than an error.
 */
export declare class NoEnvironmentError extends Error {
    constructor(message?: string);
}
//# sourceMappingURL=errors.d.ts.map