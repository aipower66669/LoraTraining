/**
 * LoRA Validation completeness: every defined set must have a preview for every
 * keep-in-Comfy checkpoint. Not complete when there are no included checkpoints
 * (vacuous “all done” must not mark a dataset Validated).
 */
export function isValidationCompleteForSets(opts: {
  setCount: number
  /** Checkpoint stems included for validation (keepInComfy !== false). */
  keepInComfyStems: readonly string[]
  /** setIndex → lowercase preview stems present under `output/Set N/`. */
  previewStemsBySet: ReadonlyMap<number, ReadonlySet<string>>
}): boolean {
  if (opts.setCount <= 0) return false
  if (opts.keepInComfyStems.length === 0) return false
  for (let i = 0; i < opts.setCount; i++) {
    const have = opts.previewStemsBySet.get(i) ?? new Set<string>()
    for (const stem of opts.keepInComfyStems) {
      if (!have.has(stem.toLowerCase())) return false
    }
  }
  return true
}
