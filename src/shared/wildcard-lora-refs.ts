/**
 * Helpers for detecting Dynamic Prompts / Comfy `<lora:…>` references in
 * wildcard library files. Step suffixes may include brace variants, e.g.
 * `name_000000{250|500}` — matching uses the root name before that suffix.
 */

const LORA_TAG_RE = /<lora:([^:>\n]+)(?::[^>\n]*)?>/gi

/** Characters allowed in a Dynamic Prompts step suffix after the last `_`. */
const STEP_SUFFIX_RE = /^[\d{}|]+$/

/**
 * Root LoRA name for matching: if the segment after the last `_` is only digits
 * and brace/pipe chars, strip it; otherwise return the full name.
 *
 * - `loraname_000000250` → `loraname`
 * - `Cat_Ds_000000{250|500}` → `Cat_Ds`
 * - `Cat_Ds` → `Cat_Ds`
 */
export function loraRootNameFromTag(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return ''
  const lastUnderscore = trimmed.lastIndexOf('_')
  if (lastUnderscore <= 0) return trimmed
  const suffix = trimmed.slice(lastUnderscore + 1)
  if (!suffix || !STEP_SUFFIX_RE.test(suffix)) return trimmed
  return trimmed.slice(0, lastUnderscore)
}

/** Unique LoRA names (tag body before optional `:weight`) found in text. */
export function extractLoraNamesFromText(text: string): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  LORA_TAG_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = LORA_TAG_RE.exec(text)) !== null) {
    const name = (m[1] ?? '').trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

/** True if any `<lora:…>` tag’s root name equals `stem` (exact, case-sensitive). */
export function textReferencesLoraStem(text: string, stem: string): boolean {
  const target = stem.trim()
  if (!target) return false
  for (const name of extractLoraNamesFromText(text)) {
    if (loraRootNameFromTag(name) === target) return true
  }
  return false
}
