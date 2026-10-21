/**
 * Identity tags: a distinctive caption fragment so each image can get a unique
 * female given name without disturbing the rest of the caption.
 *
 * Marker example: `.photo of a girl named Ada.`
 */

/** Regex matching the identity fragment (global for strip-all). */
export const IDENTITY_TAG_RE = /\.photo of a girl named ([A-Za-z]+)\./g

/** Non-global form for a single extract. */
const IDENTITY_TAG_ONE = /\.photo of a girl named ([A-Za-z]+)\./

export type IdentityTagMode = 'missing' | 'redo' | 'remove'

export function formatIdentityTag(name: string): string {
  const n = name.trim()
  if (!n || !/^[A-Za-z]+$/.test(n)) {
    throw new Error(`Invalid identity name: ${name}`)
  }
  return `.photo of a girl named ${n}.`
}

/** First identity name in the caption, or null. */
export function extractIdentityName(caption: string): string | null {
  const m = caption.match(IDENTITY_TAG_ONE)
  return m?.[1] ?? null
}

/** True when the caption already has an identity marker. */
export function hasIdentityTag(caption: string): boolean {
  return extractIdentityName(caption) != null
}

/**
 * Remove all identity markers; collapse leftover double spaces; trim.
 * Leaves all other caption text intact.
 */
export function stripIdentityTag(caption: string): string {
  return caption
    .replace(IDENTITY_TAG_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^\s+|\s+$/g, '')
}

/**
 * Ensure the caption has exactly one identity marker for `name`.
 * Strips any existing markers first, then appends the new fragment.
 */
export function upsertIdentityTag(caption: string, name: string): string {
  const stripped = stripIdentityTag(caption)
  const tag = formatIdentityTag(name)
  if (!stripped) return tag
  return `${stripped} ${tag}`
}

/** Parse `identity-names-used.txt` (one name per line). */
export function parseUsedNamesFile(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const name = line.trim()
    if (!name || !/^[A-Za-z]+$/.test(name)) continue
    if (seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

/** Serialize used names (sorted, trailing newline when non-empty). */
export function serializeUsedNames(names: Iterable<string>): string {
  const list = [...new Set([...names].filter((n) => /^[A-Za-z]+$/.test(n)))]
  list.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  if (list.length === 0) return ''
  return `${list.join('\n')}\n`
}

/** Parse `reference/names.txt` into a unique ordered pool. */
export function parseNamePool(text: string): string[] {
  return parseUsedNamesFile(text)
}

/**
 * Pick a random unused name from the pool.
 * `rng` defaults to Math.random; main process should pass crypto-backed.
 */
export function pickRandomUnusedName(
  pool: readonly string[],
  used: ReadonlySet<string>,
  rng: () => number = Math.random
): string | null {
  const available: string[] = []
  for (const name of pool) {
    if (!used.has(name)) available.push(name)
  }
  if (available.length === 0) return null
  const i = Math.floor(rng() * available.length)
  return available[Math.min(i, available.length - 1)] ?? null
}
