import { DATASET_SIDECAR } from './library-paths'

/**
 * Whether a path relative to the source dataset root should be copied when
 * duplicating a dataset. Skips `output/` and any `dataset.json` (clone must get
 * a fresh id — shared ids make both explorer tiles appear selected).
 */
export function shouldCopyPathOnDatasetDuplicate(relativePath: string): boolean {
  const rel = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!rel || rel === '.') return true
  const parts = rel.split('/').filter(Boolean)
  if (parts.length === 0) return true
  if (parts[0] === 'output') return false
  if (parts.some((p) => p.toLowerCase() === DATASET_SIDECAR.toLowerCase())) return false
  return true
}
