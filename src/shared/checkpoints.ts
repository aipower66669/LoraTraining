/** True when listOutputs includes at least one real on-disk `.safetensors` (not a planned placeholder). */
export function hasOnDiskSafetensorCheckpoints(
  checkpoints: ReadonlyArray<{ fileName: string; pending?: boolean }>
): boolean {
  return checkpoints.some(
    (c) => !c.pending && c.fileName.toLowerCase().endsWith('.safetensors')
  )
}

/** Extract training step from AI Toolkit-style names like `job_000000500.safetensors`. */
export function checkpointStepFromName(fileName: string): number | null {
  const stem = fileName.replace(/\.[^.]+$/, '')
  const match = /_(\d+)$/.exec(stem)
  if (!match) return null
  const n = Number(match[1])
  return Number.isFinite(n) ? n : null
}

/** Highest numbered step among checkpoint filenames (ignores unnumbered finals). */
export function latestCheckpointStepFromNames(fileNames: string[]): number | null {
  let max: number | null = null
  for (const name of fileNames) {
    const step = checkpointStepFromName(name)
    if (step == null) continue
    if (max == null || step > max) max = step
  }
  return max
}

/**
 * Checkpoint steps AI Toolkit is expected to write for `save_every` up to `totalSteps`,
 * always including the final total (toolkit writes an unnumbered final that we rename).
 */
export function expectedCheckpointSteps(totalSteps: number, saveEvery: number): number[] {
  const total = Math.floor(totalSteps)
  const every = Math.floor(saveEvery)
  if (!(total > 0) || !(every > 0)) return []
  const steps: number[] = []
  for (let s = every; s <= total; s += every) steps.push(s)
  if (steps.length === 0 || steps[steps.length - 1] !== total) steps.push(total)
  return steps
}

/**
 * Further-training steps still missing on disk: expected schedule entries strictly
 * after the highest existing numbered checkpoint (ignores deleted early steps).
 */
export function pendingFurtherCheckpointSteps(opts: {
  totalSteps: number
  saveEvery: number
  latestExistingStep: number
}): number[] {
  const latest = Math.max(0, Math.floor(opts.latestExistingStep))
  return expectedCheckpointSteps(opts.totalSteps, opts.saveEvery).filter((s) => s > latest)
}

export function compareCheckpointsByStep(
  a: { fileName: string; relativePath: string },
  b: { fileName: string; relativePath: string }
): number {
  const sa = checkpointStepFromName(a.fileName)
  const sb = checkpointStepFromName(b.fileName)
  if (sa !== null && sb !== null && sa !== sb) return sa - sb
  if (sa !== null && sb === null) return -1
  if (sa === null && sb !== null) return 1
  return a.relativePath.localeCompare(b.relativePath)
}

/** AI Toolkit zero-pads step suffixes to 9 digits by default. */
export const DEFAULT_CHECKPOINT_STEP_PAD = 9

export function formatCheckpointStep(step: number, padWidth = DEFAULT_CHECKPOINT_STEP_PAD): string {
  const n = Math.max(0, Math.floor(step))
  return String(n).padStart(padWidth, '0')
}

/** Infer zero-pad width from existing `name_000000250.safetensors`-style files. */
export function inferCheckpointStepPad(fileNames: string[], fallback = DEFAULT_CHECKPOINT_STEP_PAD): number {
  let width = 0
  for (const name of fileNames) {
    const stem = name.replace(/\.[^.]+$/, '')
    const match = /_(\d+)$/.exec(stem)
    if (match) width = Math.max(width, match[1]!.length)
  }
  return width > 0 ? width : fallback
}

export interface FinalCheckpointRenamePlan {
  /** Stem of the unnumbered final file (job name). */
  fromStem: string
  /** Stem with step suffix, e.g. `loraname_000001000`. */
  toStem: string
  step: number
}

/**
 * Plan renaming AI Toolkit's final unnumbered checkpoint (`{name}.safetensors`)
 * to `{name}_{paddedTotalSteps}.safetensors` so resume / sorting see the true last step.
 */
export function planFinalCheckpointRename(opts: {
  loraName: string
  totalSteps: number
  /** Basenames present in the same folder as the final checkpoint. */
  fileNames: string[]
}): FinalCheckpointRenamePlan | null {
  const loraName = opts.loraName.trim()
  const totalSteps = Math.floor(opts.totalSteps)
  if (!loraName || !Number.isFinite(totalSteps) || totalSteps <= 0) return null

  const hasFinal = opts.fileNames.some((f) => {
    const stem = f.replace(/\.[^.]+$/, '')
    return stem === loraName
  })
  if (!hasFinal) return null

  const pad = inferCheckpointStepPad(opts.fileNames)
  const toStem = `${loraName}_${formatCheckpointStep(totalSteps, pad)}`
  if (toStem === loraName) return null

  const targetTaken = opts.fileNames.some((f) => f.replace(/\.[^.]+$/, '') === toStem)
  if (targetTaken) return null

  return { fromStem: loraName, toStem, step: totalSteps }
}
