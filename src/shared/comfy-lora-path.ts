/**
 * Relative directory of a file under a LoRA root (forward slashes).
 * Empty string means the file sits at the root.
 */
export function relativeDirUnderRoot(root: string, filePath: string): string {
  const rootNorm = root.replace(/[/\\]+$/, '').replace(/\\/g, '/')
  const fileNorm = filePath.replace(/\\/g, '/')
  const lowerRoot = rootNorm.toLowerCase()
  const lowerFile = fileNorm.toLowerCase()
  if (!lowerFile.startsWith(lowerRoot + '/') && lowerFile !== lowerRoot) {
    return ''
  }
  const rel = fileNorm.slice(rootNorm.length).replace(/^\/+/, '')
  const slash = rel.lastIndexOf('/')
  if (slash < 0) return ''
  return sanitizeComfySubfolder(rel.slice(0, slash))
}

/**
 * Sanitize a relative path under ComfyUI `models/loras`.
 * Returns forward-slash form without leading/trailing slashes.
 */
export function sanitizeComfySubfolder(value: string | null | undefined): string {
  const raw = (value ?? '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!raw) return ''
  const parts: string[] = []
  for (const part of raw.split('/')) {
    const trimmed = part.trim()
    if (!trimmed || trimmed === '.' || trimmed === '..') continue
    const cleaned = trimmed
      .replace(/[<>:"|?*\u0000-\u001f]/g, '_')
      .replace(/[. ]+$/g, '')
    parts.push(cleaned || '_')
  }
  return parts.join('/')
}

/**
 * Resolve where LoRAs stage by default: Settings → validation LoRA subfolder,
 * else `!Testing`. (Per-dataset overrides were removed.)
 */
export function resolveDatasetComfySubfolder(opts: {
  /** @deprecated Ignored — staging folder is Settings-only. */
  datasetSubfolder?: string | null
  globalSubfolder?: string | null
}): string {
  const fromGlobal = sanitizeComfySubfolder(opts.globalSubfolder)
  if (fromGlobal) return fromGlobal
  return '!Testing'
}
