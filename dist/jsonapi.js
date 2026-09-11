/**
 * Helpers for the JSON:API payloads the Loft47 MCP returns.
 *
 * Shape: `{ data: {id, type, attributes, relationships} | [...], included?: [...] }`.
 * Attribute keys are camelCase; filter/include *parameters* are snake_case.
 */
/** Always returns an array, whether the document held one resource or many. */
export function list(doc) {
    if (!doc?.data)
        return [];
    return Array.isArray(doc.data) ? doc.data : [doc.data];
}
/** The single resource of a `Get*` document, or null. */
export function one(doc) {
    if (!doc?.data)
        return null;
    return Array.isArray(doc.data) ? (doc.data[0] ?? null) : doc.data;
}
/** Attributes of the single resource, or null. */
export function attrs(doc) {
    return one(doc)?.attributes ?? null;
}
/** The id of a to-one relationship, or null. */
export function relId(resource, name) {
    const data = resource?.relationships?.[name]?.data;
    if (!data || Array.isArray(data))
        return null;
    return data.id;
}
/** The ids of a to-many relationship. */
export function relIds(resource, name) {
    const data = resource?.relationships?.[name]?.data;
    if (!Array.isArray(data))
        return [];
    return data.map((r) => r.id);
}
/** Indexes `included` by `type:id` so relationship refs can be resolved cheaply. */
export function includedIndex(doc) {
    const index = new Map();
    for (const resource of doc?.included ?? [])
        index.set(`${resource.type}:${resource.id}`, resource);
    return index;
}
export function findIncluded(index, type, id) {
    if (!id)
        return null;
    return index.get(`${type}:${id}`) ?? null;
}
// ── Money ─────────────────────────────────────────────────────────────────────
/**
 * Loft47 returns money as decimal strings ("17950.0"), but the *same field* can
 * come back as a bare number on some records. Values can also be negative.
 * Everything is converted to integer cents so equality checks don't inherit
 * binary-float error — comparing `0.1 + 0.2` style sums across dozens of splits
 * would otherwise produce phantom variances.
 */
export function toCents(value) {
    if (value === null || value === undefined || value === '')
        return null;
    const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
    if (!Number.isFinite(n))
        return null;
    return Math.round(n * 100);
}
/** Like `toCents` but treats missing values as zero. */
export function centsOr0(value) {
    return toCents(value) ?? 0;
}
/** Parses a plain decimal (percentages, transaction ends) defensively. */
export function toNumber(value) {
    if (value === null || value === undefined || value === '')
        return null;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
}
/** Parses a date, tolerating null and empty strings. */
export function toDate(value) {
    if (!value || typeof value !== 'string')
        return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}
//# sourceMappingURL=jsonapi.js.map