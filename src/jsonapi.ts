/**
 * Helpers for the JSON:API payloads the Loft47 MCP returns.
 *
 * Shape: `{ data: {id, type, attributes, relationships} | [...], included?: [...] }`.
 * Attribute keys are camelCase; filter/include *parameters* are snake_case.
 */

export interface Resource<A = Record<string, unknown>> {
  id: string
  type: string
  attributes: A
  relationships?: Record<string, { data: RelRef | RelRef[] | null }>
}

export interface RelRef {
  id: string
  type: string
}

export interface Doc<A = Record<string, unknown>> {
  data: Resource<A> | Resource<A>[] | null
  included?: Resource[]
  meta?: { count?: number }
  links?: Record<string, string>
}

/** Always returns an array, whether the document held one resource or many. */
export function list<A = Record<string, unknown>>(doc: Doc<A> | null | undefined): Resource<A>[] {
  if (!doc?.data) return []
  return Array.isArray(doc.data) ? doc.data : [doc.data]
}

/** The single resource of a `Get*` document, or null. */
export function one<A = Record<string, unknown>>(doc: Doc<A> | null | undefined): Resource<A> | null {
  if (!doc?.data) return null
  return Array.isArray(doc.data) ? (doc.data[0] ?? null) : doc.data
}

/** Attributes of the single resource, or null. */
export function attrs<A = Record<string, unknown>>(doc: Doc<A> | null | undefined): A | null {
  return one(doc)?.attributes ?? null
}

/** The id of a to-one relationship, or null. */
export function relId(resource: Resource<any> | null | undefined, name: string): string | null {
  const data = resource?.relationships?.[name]?.data
  if (!data || Array.isArray(data)) return null
  return data.id
}

/** The ids of a to-many relationship. */
export function relIds(resource: Resource<any> | null | undefined, name: string): string[] {
  const data = resource?.relationships?.[name]?.data
  if (!Array.isArray(data)) return []
  return data.map((r) => r.id)
}

/** Indexes `included` by `type:id` so relationship refs can be resolved cheaply. */
export function includedIndex(doc: Doc<any> | null | undefined): Map<string, Resource> {
  const index = new Map<string, Resource>()
  for (const resource of doc?.included ?? []) index.set(`${resource.type}:${resource.id}`, resource)
  return index
}

export function findIncluded(
  index: Map<string, Resource>,
  type: string,
  id: string | null,
): Resource | null {
  if (!id) return null
  return index.get(`${type}:${id}`) ?? null
}

// ── Money ─────────────────────────────────────────────────────────────────────

/**
 * Loft47 returns money as decimal strings ("17950.0"), but the *same field* can
 * come back as a bare number on some records. Values can also be negative.
 * Everything is converted to integer cents so equality checks don't inherit
 * binary-float error — comparing `0.1 + 0.2` style sums across dozens of splits
 * would otherwise produce phantom variances.
 */
export function toCents(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''))
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

/** Like `toCents` but treats missing values as zero. */
export function centsOr0(value: unknown): number {
  return toCents(value) ?? 0
}

/** Parses a plain decimal (percentages, transaction ends) defensively. */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/** Parses a date, tolerating null and empty strings. */
export function toDate(value: unknown): Date | null {
  if (!value || typeof value !== 'string') return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}
