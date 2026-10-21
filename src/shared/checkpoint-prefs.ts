import { z } from 'zod'

/**
 * `{dataset}/output/checkpoint-prefs.json`
 * keepInComfy[stem] = false means exclude from Comfy validation staging.
 * Missing stem defaults to true (include).
 * comfyRelativeDir[stem] = subfolder under models/loras where the staged copy lives.
 * validationPreviews[stem][setLabel] = path relative to output/ (e.g. `Set 1/stem.jpg`).
 */
export const CheckpointPrefsFileSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]).default(2),
  keepInComfy: z.record(z.string(), z.boolean()).default({}),
  /** Relative dir under Comfy loras root, e.g. `!Testing` or `Characters/Foo`. */
  comfyRelativeDir: z.record(z.string(), z.string()).default({}),
  /**
   * Cached Validation Steps preview paths (relative to `output/`).
   * Avoids re-probing Set folders on every Output tab open when paths still exist.
   */
  validationPreviews: z.record(z.string(), z.record(z.string(), z.string())).default({})
})

export type CheckpointPrefsFile = z.infer<typeof CheckpointPrefsFileSchema>

export function emptyCheckpointPrefs(): CheckpointPrefsFile {
  return CheckpointPrefsFileSchema.parse({
    version: 2,
    keepInComfy: {},
    comfyRelativeDir: {},
    validationPreviews: {}
  })
}

/** Default true when the stem has never been saved. */
export function isKeepInComfy(prefs: CheckpointPrefsFile, stem: string): boolean {
  const v = prefs.keepInComfy[stem]
  return v !== false
}

export function stagedRelativeDir(
  prefs: CheckpointPrefsFile,
  stem: string
): string | undefined {
  const d = prefs.comfyRelativeDir[stem]?.trim()
  return d || undefined
}
