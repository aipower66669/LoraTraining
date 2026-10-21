/** Parse explorer name search; `"word"` → whole-word match of `word`. */
export function parseExplorerNameQuery(raw: string): {
  needle: string
  wholeWord: boolean
} {
  const trimmed = raw.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return { needle: trimmed.slice(1, -1).trim().toLowerCase(), wholeWord: true }
  }
  return { needle: trimmed.toLowerCase(), wholeWord: false }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Match a category/dataset display name against a search needle.
 * Substring by default; whole-word when `wholeWord` (quoted query).
 */
export function matchesExplorerName(
  name: string,
  needle: string,
  wholeWord: boolean
): boolean {
  if (!needle) return true
  const hay = name.toLowerCase()
  if (!wholeWord) return hay.includes(needle)
  // Word = run of letters/digits; punctuation/spaces are boundaries.
  const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(needle)}(?:$|[^a-z0-9])`, 'i')
  return re.test(name)
}
