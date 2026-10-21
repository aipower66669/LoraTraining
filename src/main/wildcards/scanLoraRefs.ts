import { readdir, readFile } from 'node:fs/promises'
import { extname, isAbsolute, join, resolve } from 'node:path'
import { textReferencesLoraStem } from '@shared/wildcard-lora-refs'

const WILDCARD_EXTS = new Set(['.txt', '.yaml', '.yml', '.json'])

/**
 * Walk a wildcards library folder and return whether any file body contains a
 * `<lora:…>` tag whose root name (before a digit/brace step suffix) equals `stem`.
 */
export async function folderReferencesLoraStem(
  root: string,
  stem: string
): Promise<boolean> {
  const trimmed = root.trim()
  const target = stem.trim()
  if (!trimmed || !target) return false
  if (!isAbsolute(trimmed)) return false

  const resolvedRoot = resolve(trimmed)

  const walk = async (dir: string): Promise<boolean> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return false
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (await walk(abs)) return true
        continue
      }
      if (!entry.isFile()) continue
      const ext = extname(entry.name).toLowerCase()
      if (!WILDCARD_EXTS.has(ext)) continue
      let text: string
      try {
        text = await readFile(abs, 'utf8')
      } catch {
        continue
      }
      if (textReferencesLoraStem(text, target)) return true
    }
    return false
  }

  return walk(resolvedRoot)
}
