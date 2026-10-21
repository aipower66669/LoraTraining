import type { ValidationProgress } from './comfy'
import { checkpointStepFromName } from './checkpoints'
import type { CheckpointEntry } from './ipc/contract'

export type ValidationSetPreview = {
  relativePath: string
  fileName: string
  bust: string
  /** Training step from the checkpoint name, when parseable. */
  step: number | null
}

/** Ordered previews for one set (checkpoint step order), plus live progress if missing. */
export function buildValidationSetPreviews(opts: {
  checkpoints: CheckpointEntry[]
  setLabel: string
  datasetId: string
  setIndex: number
  progress: ValidationProgress | null
}): ValidationSetPreview[] {
  const out: ValidationSetPreview[] = []
  const seen = new Set<string>()

  for (const cp of opts.checkpoints) {
    const img = cp.validationImages.find((x) => x.setLabel === opts.setLabel)
    if (!img || seen.has(img.relativePath)) continue
    seen.add(img.relativePath)
    out.push({
      relativePath: img.relativePath,
      fileName: cp.fileName,
      bust: `${opts.setLabel}:${img.relativePath}:${cp.mtimeMs}`,
      step: checkpointStepFromName(cp.fileName)
    })
  }

  const progress = opts.progress
  // Only while running — after done/cancelled, lastPreviewRelativePath would
  // resurrect a deleted thumb that is no longer on disk / in checkpoints.
  if (
    progress?.status === 'running' &&
    progress.datasetId === opts.datasetId &&
    progress.setIndex === opts.setIndex &&
    progress.lastPreviewRelativePath
  ) {
    const path = progress.lastPreviewRelativePath
    const bust = `${progress.jobsCompleted}:${path}`
    const fileName = progress.lastPreviewFileName ?? path
    const existing = out.findIndex((p) => p.relativePath === path)
    const step = checkpointStepFromName(fileName)
    if (existing >= 0) {
      out[existing] = { ...out[existing]!, bust, fileName, step }
    } else {
      out.push({ relativePath: path, fileName, bust, step })
    }
  }

  return out
}

/**
 * Index after the preview list changes for the same set.
 * If the user was on the last image (or the list was empty), stick to the new last;
 * otherwise keep the current index (clamped).
 */
export function nextPreviewIndexAfterListChange(opts: {
  prevLength: number
  prevIndex: number
  nextLength: number
}): number {
  if (opts.nextLength <= 0) return 0
  const wasOnLast = opts.prevLength === 0 || opts.prevIndex >= opts.prevLength - 1
  if (wasOnLast) return opts.nextLength - 1
  return Math.min(opts.prevIndex, opts.nextLength - 1)
}

/** Keep the same image number when switching sets (clamp if the other set is shorter). */
export function previewIndexForSetChange(preferredIndex: number, nextLength: number): number {
  if (nextLength <= 0) return 0
  return Math.min(Math.max(0, preferredIndex), nextLength - 1)
}

/**
 * Pick the preview that matches `preferredStep`, or the nearest step if missing.
 * `Number.POSITIVE_INFINITY` (or null) → last preview (latest step).
 * Ties on distance prefer the lower step.
 */
export function previewIndexForPreferredStep(
  preferredStep: number | null,
  previews: Array<{ step: number | null }>
): number {
  if (previews.length <= 0) return 0
  if (
    preferredStep == null ||
    !Number.isFinite(preferredStep) ||
    preferredStep === Number.POSITIVE_INFINITY
  ) {
    return previews.length - 1
  }

  let exact = -1
  let bestIdx = -1
  let bestDist = Number.POSITIVE_INFINITY
  let bestStep = Number.POSITIVE_INFINITY

  for (let i = 0; i < previews.length; i++) {
    const step = previews[i]?.step
    if (step == null) continue
    if (step === preferredStep) {
      exact = i
      break
    }
    const dist = Math.abs(step - preferredStep)
    if (dist < bestDist || (dist === bestDist && step < bestStep)) {
      bestDist = dist
      bestIdx = i
      bestStep = step
    }
  }

  if (exact >= 0) return exact
  if (bestIdx >= 0) return bestIdx
  return previews.length - 1
}

