import { readdir } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import { appError } from '@shared/errors'

const WILDCARD_EXTS = new Set(['.txt', '.yaml', '.yml', '.json'])

/**
 * Derive autocomplete keys from a wildcards library folder.
 * Key = relative path without extension, forward slashes (Dynamic Prompts style).
 * File-level keys only (no nested YAML/JSON structured extract).
 */
export function wildcardKeyFromRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/\.(txt|ya?ml|json)$/i, '')
}

export async function listWildcardKeysFromFolder(root: string): Promise<string[]> {
  const trimmed = root.trim()
  if (!trimmed) return []
  if (!isAbsolute(trimmed)) {
    throw appError('validation', 'Wildcard library folder must be an absolute path')
  }

  const resolvedRoot = resolve(trimmed)
  const keys: string[] = []

  const walk = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(abs)
        continue
      }
      if (!entry.isFile()) continue
      const ext = extname(entry.name).toLowerCase()
      if (!WILDCARD_EXTS.has(ext)) continue
      const rel = relative(resolvedRoot, abs).split(/[/\\]/).join('/')
      const key = wildcardKeyFromRelativePath(rel)
      if (key) keys.push(key)
    }
  }

  await walk(resolvedRoot)
  return [...new Set(keys)].sort((a, b) => a.localeCompare(b))
}
