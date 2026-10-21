import { z } from 'zod'

export const ExistingCopyPolicySchema = z.enum([
  'reuse_if_identical_error_if_different',
  'overwrite_if_different'
])

/** 0 = realistic, 1 = anime — injected into LT · Style Index. */
export const StyleIndexSchema = z.union([z.literal(0), z.literal(1)]).default(0)

/** Per-set validation settings (prompt/seed/weight/model). Display name is always `Set N`. */
export const ValidationSetConfigSchema = z.object({
  prompt: z.string().default(''),
  /** 0 (or any ≤0) = random at run time; positive = fixed seed. */
  seed: z.number().default(0),
  loraWeight: z.number().default(1),
  styleIndex: StyleIndexSchema,
  /**
   * Checkpoint for this set (`LT · Model`). `"Default"` = Settings → default
   * validation model. Lets each set use a different model.
   */
  validationModel: z.string().default('Default'),
  existingCopyPolicy: ExistingCopyPolicySchema.default(
    'reuse_if_identical_error_if_different'
  )
})

export type ValidationSetConfig = z.infer<typeof ValidationSetConfigSchema>
export type StyleIndex = z.infer<typeof StyleIndexSchema>

export type CloneValidationSetsMode = 'overwrite' | 'add'

export function defaultValidationSetConfig(
  overrides?: Partial<ValidationSetConfig>
): ValidationSetConfig {
  return ValidationSetConfigSchema.parse(overrides ?? {})
}

/** Deep-copy a set config through the schema (stable clone for copy/paste between datasets). */
export function cloneValidationSetConfig(source: ValidationSetConfig): ValidationSetConfig {
  return ValidationSetConfigSchema.parse({
    prompt: source.prompt,
    seed: source.seed,
    loraWeight: source.loraWeight,
    styleIndex: normalizeStyleIndex(source.styleIndex),
    validationModel: source.validationModel?.trim() || 'Default',
    existingCopyPolicy: source.existingCopyPolicy
  })
}

/** Merge cloned source sets into the target list (`overwrite` replaces, `add` appends). */
export function mergeClonedValidationSets(
  current: ValidationSetConfig[],
  source: ValidationSetConfig[],
  mode: CloneValidationSetsMode
): ValidationSetConfig[] {
  const cloned = source.map(cloneValidationSetConfig)
  if (mode === 'overwrite') {
    return cloned.length > 0 ? cloned : [defaultValidationSetConfig()]
  }
  if (cloned.length === 0) return current.length > 0 ? current : [defaultValidationSetConfig()]
  const base = current.length > 0 ? current : [defaultValidationSetConfig()]
  return [...base, ...cloned]
}

/**
 * New set cloned from the previous one (prompt/weight/style kept).
 * Seed: stay at 0 when previous is 0; otherwise bump by 1 (same for other ≤0).
 */
export function validationSetFromPrevious(previous: ValidationSetConfig): ValidationSetConfig {
  const base = ValidationSetConfigSchema.parse(previous)
  const nextSeed = base.seed > 0 ? base.seed + 1 : base.seed
  return ValidationSetConfigSchema.parse({
    prompt: base.prompt,
    seed: nextSeed,
    loraWeight: base.loraWeight,
    styleIndex: normalizeStyleIndex(base.styleIndex),
    validationModel: base.validationModel?.trim() || 'Default',
    existingCopyPolicy: base.existingCopyPolicy
  })
}

/** Folder / tab label for 0-based index. */
export function validationSetLabel(index: number): string {
  return `Set ${index + 1}`
}

/** True for directories named `Set 1`, `Set 2`, … under dataset output. */
export function isValidationSetDirName(name: string): boolean {
  return /^Set \d+$/.test(name)
}

/** Preview folders under output/ that must not be walked as training checkpoints. */
export function isPreviewOutputDirName(name: string): boolean {
  // Keep in sync with Stress / Weight set dir names (avoid import cycles).
  return (
    isValidationSetDirName(name) || /^Stress \d+$/.test(name) || /^Weight \d+$/.test(name)
  )
}

export function normalizeStyleIndex(value: unknown): 0 | 1 {
  return Number(value) === 1 ? 1 : 0
}
