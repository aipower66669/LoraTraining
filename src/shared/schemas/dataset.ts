import { z } from 'zod'
import { defaultValidationSetConfig, ValidationSetConfigSchema } from '../validation-sets'
import { defaultStressTestSetConfig, StressTestSetConfigSchema } from '../stress-sets'
import { defaultWeightSetConfig, WeightSetConfigSchema } from '../weight-sets'

export const DatasetStatsSchema = z.object({
  images: z.number(),
  captions: z.number(),
  stemCollisions: z.array(z.string()).default([])
})

/**
 * Migrate legacy dataset-level fields, then drop them from the object.
 * - `validationModel` → copied onto sets that lack one
 * - `comfyLoraSubfolder` → removed (staging folder is Settings-only)
 */
function migrateDatasetRecord(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const o = { ...(raw as Record<string, unknown>) }
  const legacy = typeof o.validationModel === 'string' ? o.validationModel.trim() : ''
  if (legacy && Array.isArray(o.validationSets)) {
    o.validationSets = o.validationSets.map((s) => {
      if (!s || typeof s !== 'object') return s
      const set = s as Record<string, unknown>
      const existing =
        typeof set.validationModel === 'string' ? set.validationModel.trim() : ''
      if (existing) return set
      return { ...set, validationModel: legacy }
    })
  }
  delete o.validationModel
  delete o.comfyLoraSubfolder
  return o
}

export const DatasetRecordSchema = z.preprocess(
  migrateDatasetRecord,
  z.object({
    id: z.string(),
    name: z.string(),
    folderPath: z.string(),
    categoryId: z.string(),
    trigger: z.string().default(''),
    /** Short JoyCaption dataset context (appended as DATASET CONTEXT). */
    captionGuidance: z.string().default(''),
    captionExt: z.string().default('txt'),
    notes: z.string().default(''),
    /** User marked captions/images reviewed and ready for training. */
    ready: z.boolean().default(false),
    /**
     * Sticky once a training job completes (or a scan finds `.safetensors`).
     * Cleared when training output is wiped. Independent of `validated`.
     */
    trained: z.boolean().default(false),
    /**
     * True when every LoRA Validation set has a preview for every keep-in-Comfy
     * checkpoint. Demoted when training adds checkpoints or previews are removed.
     */
    validated: z.boolean().default(false),
    /**
     * Sticky only via explicit user “Mark as Done” (after Validated + wildcard
     * LoRA reference check). Cleared when Validated demotes — never auto-set.
     */
    done: z.boolean().default(false),
    /** Library thumbnail; null = first image (alphabetical). */
    coverFileName: z.string().nullable().default(null),
    /**
     * Image file names that were used as “Create New Dataset” sources from this
     * dataset. Drives the magenta border in the image grid (`hasSpawned`).
     */
    spawnedFromImages: z.array(z.string()).default([]),
    /** Ordered LoRA Validation sets; always at least Set 1. */
    validationSets: z
      .array(ValidationSetConfigSchema)
      .default(() => [defaultValidationSetConfig()])
      .transform((sets) => (sets.length > 0 ? sets : [defaultValidationSetConfig()])),
    /**
     * Model Stress-Testing sets (one LoRA × many models). Independent of
     * `validationSets` (one model × many LoRAs).
     */
    stressTestSets: z
      .array(StressTestSetConfigSchema)
      .default(() => [defaultStressTestSetConfig()])
      .transform((sets) => (sets.length > 0 ? sets : [defaultStressTestSetConfig()])),
    /**
     * Validation Weight sets (one LoRA × many strengths). Independent of
     * Steps (`validationSets`) and Stress (`stressTestSets`).
     */
    weightSets: z
      .array(WeightSetConfigSchema)
      .default(() => [defaultWeightSetConfig()])
      .transform((sets) => (sets.length > 0 ? sets : [defaultWeightSetConfig()])),
    /**
     * Stress Compare overview: preferred model row order (dataset-scoped).
     * Models with no previews are omitted at read time.
     */
    stressCompareModelOrder: z.array(z.string()).default([]),
    /**
     * Stress Compare overview: preferred stress-set column order (0-based indices).
     * Empty = default newest-activity-first.
     */
    stressCompareSetOrder: z.array(z.number().int().nonnegative()).default([]),
    /** Stress Compare overview: model names whose rows are collapsed. */
    stressCompareCollapsedModels: z.array(z.string()).default([]),
    createdAt: z.string(),
    updatedAt: z.string(),
    stats: DatasetStatsSchema.default({ images: 0, captions: 0, stemCollisions: [] })
  })
)

export type DatasetRecord = z.infer<typeof DatasetRecordSchema>

/** Hard rule: do not train (or create a job) unless every image has a caption. */
export function datasetFullyCaptioned(stats: {
  images: number
  captions: number
}): boolean {
  return stats.images > 0 && stats.captions >= stats.images
}

/** Prefer live per-image flags when the open dataset detail is available. */
export function imagesFullyCaptioned(
  images: Array<{ captionExists: boolean }>
): boolean {
  return images.length > 0 && images.every((i) => i.captionExists)
}

export function missingCaptionCount(stats: { images: number; captions: number }): number {
  return Math.max(0, stats.images - stats.captions)
}

export function missingCaptionCountFromImages(
  images: Array<{ captionExists: boolean }>
): number {
  return images.filter((i) => !i.captionExists).length
}

export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp'])

/** Basename without extension; preserves case of the image stem. */
export function imageStem(fileName: string): string {
  const i = fileName.lastIndexOf('.')
  return i <= 0 ? fileName : fileName.slice(0, i)
}

/** Safe folder name for renaming a dataset directory on disk. */
export function sanitizeDatasetFolderName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 120)
  return cleaned || 'dataset'
}

/** Default display name for Duplicate: `{name} V2`, or next `Vn` if already versioned. */
export function suggestDuplicateDatasetName(name: string): string {
  const trimmed = name.trim() || 'dataset'
  const m = trimmed.match(/^(.*)\s+V(\d+)$/i)
  const basePart = m?.[1]
  const versionPart = m?.[2]
  if (basePart != null && versionPart != null) {
    const base = basePart.trim() || 'dataset'
    return `${base} V${Number(versionPart) + 1}`
  }
  return `${trimmed} V2`
}
