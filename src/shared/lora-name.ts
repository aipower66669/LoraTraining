import { checkpointStepFromName } from './checkpoints'
import { sanitizeJobName } from './schemas/training-config'

/** Breadcrumb-style fallback when a dataset has no category. */
export const LORA_NAME_UNCATEGORIZED = 'Uncategorized'

/**
 * New-job convention: `Category_Dataset` (spaces/punctuation → `_`).
 * Example: "Category name" + "Dataset name" → `Category_name_Dataset_name`
 */
export function defaultLoraName(categoryName: string, datasetName: string): string {
  const cat = categoryName.trim() || LORA_NAME_UNCATEGORIZED
  const ds = datasetName.trim() || 'dataset'
  return sanitizeJobName(`${cat}_${ds}`)
}

/**
 * LoRA stem from a checkpoint basename: strip extension and trailing `_NNNN` step.
 * `FluoKawaii_000000500.safetensors` → `FluoKawaii`; `FluoKawaii.safetensors` → `FluoKawaii`.
 */
export function loraStemFromCheckpointFileName(fileName: string): string | null {
  const base = fileName.replace(/\.[^.]+$/, '').trim()
  if (!base) return null
  const step = checkpointStepFromName(fileName)
  if (step == null) return base
  const match = /_(\d+)$/.exec(base)
  if (!match) return base
  const stem = base.slice(0, -match[0].length)
  return stem || null
}

/**
 * Prefer the stem of the highest-step numbered checkpoint; else first unnumbered
 * `.safetensors` stem; else null.
 */
export function existingLoraStemFromCheckpointNames(fileNames: string[]): string | null {
  let bestStep = -1
  let bestStem: string | null = null
  let unnumbered: string | null = null

  for (const name of fileNames) {
    if (!name.toLowerCase().endsWith('.safetensors')) continue
    const stem = loraStemFromCheckpointFileName(name)
    if (!stem) continue
    const step = checkpointStepFromName(name)
    if (step != null) {
      if (step > bestStep) {
        bestStep = step
        bestStem = stem
      }
    } else if (unnumbered == null) {
      unnumbered = stem
    }
  }

  return bestStem ?? unnumbered
}

/**
 * Suggest LoRA / process name for a job:
 * existing output stem if checkpoints exist, otherwise Category_Dataset.
 */
export function suggestLoraName(opts: {
  categoryName: string
  datasetName: string
  checkpointFileNames: string[]
}): string {
  const existing = existingLoraStemFromCheckpointNames(opts.checkpointFileNames)
  if (existing) return sanitizeJobName(existing)
  return defaultLoraName(opts.categoryName, opts.datasetName)
}
