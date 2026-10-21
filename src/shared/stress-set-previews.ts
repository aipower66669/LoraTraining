import type { StressTestProgress } from './comfy'
import { modelPreviewStemMap, previewStemsForModel } from './stress-sets'

export type StressSetPreview = {
  relativePath: string
  stem: string
  /** Cache-bust token for media URLs (updates when a live preview is rewritten). */
  bust: string
}

/**
 * Ordered stress previews for one set (selected-model order), plus the live
 * progress preview so the UI can show a just-written image before disk reload.
 */
export function buildStressSetPreviews(opts: {
  diskPreviews: ReadonlyArray<{ stem: string; relativePath: string }>
  models: readonly string[]
  datasetId: string
  setIndex: number
  progress: StressTestProgress | null
}): StressSetPreview[] {
  const stemByModel = modelPreviewStemMap([...opts.models])
  const byStemLower = new Map(
    opts.diskPreviews.map((p) => [p.stem.toLowerCase(), p] as const)
  )
  const out: StressSetPreview[] = []
  const seen = new Set<string>()

  for (const model of opts.models) {
    const stem = stemByModel.get(model)
    if (!stem) continue
    let disk: (typeof opts.diskPreviews)[number] | undefined
    for (const candidate of previewStemsForModel(model, stem)) {
      disk = byStemLower.get(candidate.toLowerCase())
      if (disk) break
    }
    if (!disk || seen.has(disk.relativePath)) continue
    seen.add(disk.relativePath)
    out.push({
      relativePath: disk.relativePath,
      stem: disk.stem,
      bust: disk.stem
    })
  }

  for (const p of opts.diskPreviews) {
    if (seen.has(p.relativePath)) continue
    seen.add(p.relativePath)
    out.push({ relativePath: p.relativePath, stem: p.stem, bust: p.stem })
  }

  const progress = opts.progress
  // Only while running — after done/cancelled, lastPreviewRelativePath would
  // resurrect a deleted thumb that is no longer on disk.
  if (
    progress?.status === 'running' &&
    progress.datasetId === opts.datasetId &&
    progress.setIndex === opts.setIndex &&
    progress.lastPreviewRelativePath
  ) {
    const path = progress.lastPreviewRelativePath.replace(/\\/g, '/')
    const bust = `${progress.jobsCompleted}:${path}`
    const base = path.split('/').pop() ?? path
    const stem =
      (progress.lastPreviewFileName ?? progress.currentModel ?? base).replace(
        /\.(jpe?g|png|webp|safetensors)$/i,
        ''
      ) || base
    const existing = out.findIndex((p) => p.relativePath.replace(/\\/g, '/') === path)
    if (existing >= 0) {
      const prev = out[existing]!
      out[existing] = { ...prev, bust }
    } else {
      out.push({ relativePath: path, stem, bust })
    }
  }

  return out
}
