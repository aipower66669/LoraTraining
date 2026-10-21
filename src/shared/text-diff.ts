export type DiffPart = {
  type: 'equal' | 'add' | 'remove'
  text: string
}

/** Split into words and whitespace so caption edits stay readable. */
export function tokenizeForDiff(text: string): string[] {
  if (!text) return []
  return text.split(/(\s+)/).filter((t) => t.length > 0)
}

/**
 * Word-level LCS diff. Returns a unified sequence of equal / remove / add parts.
 */
export function diffTokens(before: string, after: string): DiffPart[] {
  if (before === after) {
    return before ? [{ type: 'equal', text: before }] : []
  }
  const a = tokenizeForDiff(before)
  const b = tokenizeForDiff(after)
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        a[i] === b[j] ? (dp[i + 1]![j + 1]! + 1) : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const parts: DiffPart[] = []
  let i = 0
  let j = 0
  const push = (type: DiffPart['type'], text: string): void => {
    const last = parts[parts.length - 1]
    if (last && last.type === type) last.text += text
    else parts.push({ type, text })
  }
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('equal', a[i]!)
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      push('remove', a[i]!)
      i++
    } else {
      push('add', b[j]!)
      j++
    }
  }
  while (i < n) {
    push('remove', a[i]!)
    i++
  }
  while (j < m) {
    push('add', b[j]!)
    j++
  }
  return parts
}

export function partsForBefore(parts: DiffPart[]): DiffPart[] {
  return parts.filter((p) => p.type !== 'add')
}

export function partsForAfter(parts: DiffPart[]): DiffPart[] {
  return parts.filter((p) => p.type !== 'remove')
}
