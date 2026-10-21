import {
  formatCheckpointStep,
  inferCheckpointStepPad,
  latestCheckpointStepFromNames,
  pendingFurtherCheckpointSteps
} from '@shared/checkpoints'
import { existingLoraStemFromCheckpointNames } from '@shared/lora-name'
import type { CheckpointEntry } from '@shared/ipc/contract'

export type InFlightTrainingPlan = {
  totalSteps: number
  saveEvery: number
  loraName: string
}

/** Resolve in-flight job plan (draft/queued/running/paused) for a dataset, if any. */
export async function loadInFlightTrainingPlan(
  datasetId: string
): Promise<InFlightTrainingPlan | null> {
  const { getInFlightTrainingPlan } = await import('../jobs/store')
  return getInFlightTrainingPlan(datasetId)
}

/** Synthetic Output-tab rows for steps planned but not yet written. */
export function buildPendingCheckpointEntries(opts: {
  plan: InFlightTrainingPlan
  existingFileNames: string[]
  /** Fallback stem when output has no checkpoints yet. */
  fallbackStem: string
}): CheckpointEntry[] {
  const latest = latestCheckpointStepFromNames(opts.existingFileNames) ?? 0
  const pendingSteps = pendingFurtherCheckpointSteps({
    totalSteps: opts.plan.totalSteps,
    saveEvery: opts.plan.saveEvery,
    latestExistingStep: latest
  })
  if (pendingSteps.length === 0) return []

  const stem =
    existingLoraStemFromCheckpointNames(opts.existingFileNames) ||
    opts.plan.loraName.trim() ||
    opts.fallbackStem.trim() ||
    'lora'
  const pad = inferCheckpointStepPad(opts.existingFileNames)
  return pendingSteps.map((step) => {
    const fileName = `${stem}_${formatCheckpointStep(step, pad)}.safetensors`
    return {
      fileName,
      relativePath: `pending:${step}`,
      sizeBytes: 0,
      mtimeMs: 0,
      validationImageRelativePath: null,
      validationImages: [],
      averageRating: null,
      ratingCount: 0,
      keepInComfy: false,
      comfyRelativeDir: null,
      pending: true
    }
  })
}
