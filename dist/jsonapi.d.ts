/**
 * Helpers for the JSON:API payloads the Loft47 MCP returns.
 *
 * Shape: `{ data: {id, type, attributes, relationships} | [...], included?: [...] }`.
 * Attribute keys are camelCase; filter/include *parameters* are snake_case.
 */
export interface Resource<A = Record<string, unknown>> {
    id: string;
    type: string;
    attributes: A;
    relationships?: Record<string, {
        data: RelRef | RelRef[] | null;
    }>;
}
export interface RelRef {
    id: string;
    type: string;
}
export interface Doc<A = Record<string, unknown>> {
    data: Resource<A> | Resource<A>[] | null;
    included?: Resource[];
    meta?: {
        count?: number;
    };
    links?: Record<string, string>;
}
/** Always returns an array, whether the document held one resource or many. */
export declare function list<A = Record<string, unknown>>(doc: Doc<A> | null | undefined): Resource<A>[];
/** The single resource of a `Get*` document, or null. */
export declare function one<A = Record<string, unknown>>(doc: Doc<A> | null | undefined): Resource<A> | null;
/** Attributes of the single resource, or null. */
export declare function attrs<A = Record<string, unknown>>(doc: Doc<A> | null | undefined): A | null;
/** The id of a to-one relationship, or null. */
export declare function relId(resource: Resource<any> | null | undefined, name: string): string | null;
/** The ids of a to-many relationship. */
export declare function relIds(resource: Resource<any> | null | undefined, name: string): string[];
/** Indexes `included` by `type:id` so relationship refs can be resolved cheaply. */
export declare function includedIndex(doc: Doc<any> | null | undefined): Map<string, Resource>;
export declare function findIncluded(index: Map<string, Resource>, type: string, id: string | null): Resource | null;
/**
 * Loft47 returns money as decimal strings ("17950.0"), but the *same field* can
 * come back as a bare number on some records. Values can also be negative.
 * Everything is converted to integer cents so equality checks don't inherit
 * binary-float error — comparing `0.1 + 0.2` style sums across dozens of splits
 * would otherwise produce phantom variances.
 */
export declare function toCents(value: unknown): number | null;
/** Like `toCents` but treats missing values as zero. */
export declare function centsOr0(value: unknown): number;
/** Parses a plain decimal (percentages, transaction ends) defensively. */
export declare function toNumber(value: unknown): number | null;
/** Parses a date, tolerating null and empty strings. */
export declare function toDate(value: unknown): Date | null;
//# sourceMappingURL=jsonapi.d.ts.map