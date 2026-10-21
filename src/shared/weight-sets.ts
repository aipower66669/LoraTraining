import { z } from 'zod'
import {
  ExistingCopyPolicySchema,
  StyleIndexSchema,
  normalizeStyleIndex
} from './validation-sets'

/** Integer scale for weight arithmetic (avoids 0.6 + 0.2 float drift). */
const WEIGHT_SCALE = 1000

/**
 * Per-set Validation Weight config: one fixed LoRA checkpoint + model,
 * many weights from min…max by step.
 */
export const WeightSetConfigSchema = z.object({
  prompt: z.string().default(''),
  seed: z.number().default(1),
  styleIndex: StyleIndexSchema,
  /** Checkpoint / UNET for this set (`LT · Model`). `"Default"` = Settings default. */
  validationModel: z.string().default('Default'),
  /**
   * Basename of the chosen training checkpoint under `output/`
   * (e.g. `MyLora_000500.safetensors`). Null = not chosen yet.
   */
  checkpointFileName: z.string().nullable().default(null),
  /** Inclusive lower bound of the LoRA weight sweep. */
  weightMin: z.number().default(0.6),
  /** Inclusive upper bound of the LoRA weight sweep (when it lands on the grid). */
  weightMax: z.number().default(1.4),
  /** Step size between weights (must be &gt; 0). */
  weightStep: z.number().default(0.2),
  existingCopyPolicy: ExistingCopyPolicySchema.default(
    'reuse_if_identical_error_if_different'
  )
})

export type WeightSetConfig = z.infer<typeof WeightSetConfigSchema>

export function defaultWeightSetConfig(
  overrides?: Partial<WeightSetConfig>
): WeightSetConfig {
  return WeightSetConfigSchema.parse(overrides ?? {})
}

/** New set cloned from the previous one (range kept, seed + 1). */
export function weightSetFromPrevious(previous: WeightSetConfig): WeightSetConfig {
  const base = WeightSetConfigSchema.parse(previous)
  const nextSeed = base.seed <= 0 ? 1 : base.seed + 1
  return WeightSetConfigSchema.parse({
    prompt: base.prompt,
    seed: nextSeed,
    styleIndex: normalizeStyleIndex(base.styleIndex),
    validationModel: base.validationModel?.trim() || 'Default',
    checkpointFileName: base.checkpointFileName,
    weightMin: base.weightMin,
    weightMax: base.weightMax,
    weightStep: base.weightStep,
    existingCopyPolicy: base.existingCopyPolicy
  })
}

/** Folder / tab label for 0-based index. */
export function weightSetLabel(index: number): string {
  return `Weight ${index + 1}`
}

/** True for directories named `Weight 1`, `Weight 2`, … under dataset output. */
export function isWeightSetDirName(name: string): boolean {
  return /^Weight \d+$/.test(name)
}

function toScaled(n: number): number {
  return Math.round(n * WEIGHT_SCALE)
}

function fromScaled(n: number): number {
  return n / WEIGHT_SCALE
}

/**
 * Clean weight token for filenames / UI (e.g. `0.6`, `1.0`, `1.2`).
 * Whole numbers keep one decimal place so explorers sort with fractional weights
 * (`…_0.8.jpg`, `…_1.0.jpg`, `…_1.2.jpg` — not a bare `…_1.jpg` that sorts last).
 * Avoids float junk like `0.6000000001`.
 */
export function formatWeightToken(weight: number): string {
  if (!Number.isFinite(weight)) return '0.0'
  const scaled = toScaled(weight)
  const neg = scaled < 0
  const abs = Math.abs(scaled)
  const whole = Math.floor(abs / WEIGHT_SCALE)
  let frac = String(abs % WEIGHT_SCALE).padStart(3, '0').replace(/0+$/, '')
  if (!frac) frac = '0'
  const body = `${whole}.${frac}`
  return neg ? `-${body}` : body
}

/**
 * Filesystem-safe stem from a training checkpoint basename
 * (e.g. `MyLora_000500.safetensors` → `MyLora_000500`).
 */
export function sanitizeCheckpointStem(checkpointFileName: string): string {
  const base =
    checkpointFileName.replace(/\\/g, '/').split('/').pop()?.trim() || 'checkpoint'
  const noExt = base.replace(/\.(safetensors|ckpt|pt|pth|bin|gguf)$/i, '')
  const cleaned = noExt
    .replace(/[<>:"|?*\u0000-\u001f]/g, '_')
    .replace(/[/\\]/g, '_')
    .replace(/[. ]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 120)
  return cleaned || 'checkpoint'
}

/**
 * Preview basename under `output/Weight N/`:
 * `{checkpointStem}_{weight}` (e.g. `MyLora_000500_0.6`).
 */
export function formatWeightPreviewStem(
  checkpointFileName: string,
  weight: number
): string {
  return `${sanitizeCheckpointStem(checkpointFileName)}_${formatWeightToken(weight)}`
}

export type EnumerateWeightsResult =
  | { ok: true; weights: number[] }
  | { ok: false; error: string }

/**
 * Enumerate inclusive weight steps on an integer grid.
 * Example: min=0.6, max=1.4, step=0.2 → [0.6, 0.8, 1, 1.2, 1.4].
 */
export function enumerateWeightSteps(
  weightMin: number,
  weightMax: number,
  weightStep: number
): EnumerateWeightsResult {
  if (!Number.isFinite(weightMin) || !Number.isFinite(weightMax) || !Number.isFinite(weightStep)) {
    return { ok: false, error: 'Weight min, max, and step must be finite numbers.' }
  }
  if (weightStep <= 0) {
    return { ok: false, error: 'Weight step must be greater than 0.' }
  }
  if (weightMax < weightMin) {
    return { ok: false, error: 'Weight max must be greater than or equal to min.' }
  }
  const minS = toScaled(weightMin)
  const maxS = toScaled(weightMax)
  const stepS = toScaled(weightStep)
  if (stepS <= 0) {
    return { ok: false, error: 'Weight step is too small (use at least 0.001).' }
  }
  const weights: number[] = []
  for (let cur = minS; cur <= maxS; cur += stepS) {
    weights.push(fromScaled(cur))
    if (weights.length > 500) {
      return { ok: false, error: 'Weight range produces too many steps (max 500).' }
    }
  }
  if (weights.length === 0) {
    return { ok: false, error: 'Weight range produces no steps.' }
  }
  return { ok: true, weights }
}

/** Weights that do not yet have a preview under `existingStemsLower`. */
export function weightsMissingPreviews(
  checkpointFileName: string,
  weights: readonly number[],
  existingStemsLower: ReadonlySet<string>
): number[] {
  return weights.filter(
    (w) =>
      !existingStemsLower.has(
        formatWeightPreviewStem(checkpointFileName, w).toLowerCase()
      )
  )
}
