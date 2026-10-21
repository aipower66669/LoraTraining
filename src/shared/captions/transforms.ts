import { mergeAppendedCaption } from '../joycaption'

/**
 * True when `trigger` appears as its own caption token (not a substring of another word).
 * Case-insensitive. Commas and whitespace count as token boundaries (Booru-style lists).
 */
export function hasTrigger(text: string, trigger: string): boolean {
  const token = trigger.trim()
  if (!token) return true
  // Strip UTF-8 BOM — otherwise a leading trigger never matches ^
  const body = text.replace(/^\uFEFF/, '')
  if (!body) return false
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(?:^|[\\s,])${escaped}(?=$|[\\s,])`, 'i')
  return re.test(body)
}

/** Prefix values should end with ", " (comma + space) for caption keyword lists. */
export function normalizePrefixSeparator(value: string): string {
  if (!value) return value
  if (value.endsWith(', ')) return value
  return `${value}, `
}

/** Suffix values should start with ", " (comma + space) for caption keyword lists. */
export function normalizeSuffixSeparator(value: string): string {
  if (!value) return value
  if (value.startsWith(', ')) return value
  return `, ${value}`
}

export function applyBulkOp(
  text: string | null,
  op: {
    op: string
    value?: string
    find?: string
    replace?: string
    mode?: 'prepend' | 'append' | 'missing' | 'overwrite'
    prependTrigger?: boolean
    /** Optional override (Create Job passes the UI trigger so disk lag cannot false-flag). */
    trigger?: string
  },
  trigger: string
): { text: string | null; changed: boolean; create: boolean } {
  const existing = text ?? ''
  const triggerWord = (op.trigger ?? trigger).trim()

  switch (op.op) {
    case 'prefix': {
      const value = normalizePrefixSeparator(op.value ?? '')
      const next = value + existing
      return { text: next, changed: next !== existing, create: text === null }
    }
    case 'suffix': {
      const value = normalizeSuffixSeparator(op.value ?? '')
      const next = existing + value
      return { text: next, changed: next !== existing, create: text === null }
    }
    case 'replace': {
      if (text === null) return { text: null, changed: false, create: false }
      const find = op.find ?? ''
      if (!find) return { text, changed: false, create: false }
      const next = existing.split(find).join(op.replace ?? '')
      return { text: next, changed: next !== existing, create: false }
    }
    case 'remove': {
      if (text === null) return { text: null, changed: false, create: false }
      const value = op.value ?? ''
      if (!value) return { text, changed: false, create: false }
      const next = existing.split(value).join('')
      return { text: next, changed: next !== existing, create: false }
    }
    case 'ensureTrigger': {
      if (!triggerWord) return { text: existing, changed: false, create: text === null }
      if (hasTrigger(existing, triggerWord)) {
        return { text: existing, changed: false, create: false }
      }
      const mode = op.mode === 'append' ? 'append' : 'prepend'
      const next =
        mode === 'append'
          ? existing
            ? `${existing}${normalizeSuffixSeparator(triggerWord)}`
            : triggerWord
          : existing
            ? `${normalizePrefixSeparator(triggerWord)}${existing}`
            : normalizePrefixSeparator(triggerWord)
      return { text: next, changed: true, create: text === null }
    }
    case 'stripTrigger': {
      if (text === null || !triggerWord) return { text, changed: false, create: false }
      if (!hasTrigger(existing, triggerWord)) return { text, changed: false, create: false }
      const escaped = triggerWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const next = existing
        .replace(/^\uFEFF/, '')
        // "trigger, " at start or after a boundary
        .replace(new RegExp(`(?:^|[\\s,])${escaped}\\s*,\\s*`, 'gi'), (m) =>
          m[0] === ',' || m[0] === ' ' ? m[0]! : ''
        )
        // bare "trigger" token
        .replace(new RegExp(`(?:^|[\\s,])${escaped}(?=$|[\\s,])`, 'gi'), (m) =>
          m[0] === ',' || m[0] === ' ' ? m[0]! : ''
        )
        .replace(/\s+/g, ' ')
        .replace(/^,\s*|\s*,\s*$/g, '')
        .replace(/,\s*,+/g, ',')
        .trim()
      return { text: next, changed: next !== existing, create: false }
    }
    case 'setText': {
      const mode = op.mode === 'overwrite' || op.mode === 'append' ? op.mode : 'missing'
      const caption = op.value ?? ''
      const prepend = Boolean(op.prependTrigger) && Boolean(triggerWord)

      const withOptionalTrigger = (body: string): string => {
        if (!prepend) return body
        if (hasTrigger(body, triggerWord)) return body
        return body ? `${normalizePrefixSeparator(triggerWord)}${body}` : triggerWord
      }

      if (mode === 'missing') {
        if (text !== null) return { text, changed: false, create: false }
        const next = withOptionalTrigger(caption)
        return { text: next, changed: true, create: true }
      }
      if (mode === 'overwrite') {
        const next = withOptionalTrigger(caption)
        return {
          text: next,
          changed: text === null || next !== existing,
          create: text === null
        }
      }
      // append
      if (text === null) {
        const next = withOptionalTrigger(caption)
        return { text: next, changed: true, create: true }
      }
      const merged = mergeAppendedCaption(existing, caption)
      const next = withOptionalTrigger(merged)
      return { text: next, changed: next !== existing, create: false }
    }
    default:
      return { text, changed: false, create: false }
  }
}
