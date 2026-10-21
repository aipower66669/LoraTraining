import type { TrainingConfig } from './schemas/training-config'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Structural equality for JSON-like training config leaves. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) {
      if (!deepEqual(a[k], b[k])) return false
    }
    return true
  }
  return false
}

/**
 * Copy leaves that changed between `before` and `after` onto `target`.
 * Objects are merged recursively; arrays/primitives are replaced wholesale.
 */
function applyChangedLeaves(target: unknown, before: unknown, after: unknown): unknown {
  if (isPlainObject(after) && isPlainObject(before) && isPlainObject(target)) {
    const out: Record<string, unknown> = { ...target }
    for (const key of Object.keys(after)) {
      if (deepEqual(before[key], after[key])) continue
      const tChild = target[key]
      const bChild = before[key]
      const aChild = after[key]
      if (isPlainObject(aChild) && isPlainObject(bChild) && isPlainObject(tChild)) {
        out[key] = applyChangedLeaves(tChild, bChild, aChild)
      } else {
        out[key] = structuredClone(aChild)
      }
    }
    return out
  }
  return structuredClone(after)
}

/**
 * Apply only the fields the user changed in a multi-edit form to each job config.
 * Always preserves per-job LoRA name, trigger, training folder, and dataset folder path.
 */
export function applySharedTrainingConfigChange(
  targets: TrainingConfig[],
  before: TrainingConfig,
  after: TrainingConfig
): TrainingConfig[] {
  if (deepEqual(before, after)) return targets.map((t) => structuredClone(t))

  return targets.map((target) => {
    const merged = applyChangedLeaves(target, before, after) as TrainingConfig
    const ds0 = merged.datasets[0]
    const targetDs0 = target.datasets[0]
    return {
      ...merged,
      name: target.name,
      trigger_word: target.trigger_word,
      training_folder: target.training_folder,
      // Model / VRAM is library-wide (Settings), not a per-job multi-edit field.
      model: target.model,
      datasets:
        ds0 && targetDs0
          ? merged.datasets.map((row, i) =>
              i === 0 ? { ...row, folder_path: targetDs0.folder_path } : row
            )
          : merged.datasets
    }
  })
}
