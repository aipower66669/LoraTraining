import type { BulkTransformResult } from '@shared/ipc/contract'
import { unwrap } from '../store'

/** Dry-run Ensure Trigger — how many captions lack this trigger keyword (reads each .txt). */
export async function countCaptionsMissingTrigger(
  datasetId: string,
  trigger: string
): Promise<number> {
  const token = trigger.trim()
  if (!token) return 0
  const preview = unwrap(
    await window.loraTraining.captions.bulkTransform({
      datasetId,
      // Pass the UI trigger explicitly — do not trust a possibly unsaved sidecar value.
      op: { op: 'ensureTrigger', mode: 'prepend', trigger: token },
      dryRun: true
    })
  ) as BulkTransformResult
  return preview.changed
}

/** Prepend “trigger, ” only where missing — same as Ensure Trigger (prepend). */
export async function fixMissingTriggers(
  datasetId: string,
  trigger: string
): Promise<BulkTransformResult> {
  const token = trigger.trim()
  return unwrap(
    await window.loraTraining.captions.bulkTransform({
      datasetId,
      op: { op: 'ensureTrigger', mode: 'prepend', trigger: token },
      dryRun: false
    })
  ) as BulkTransformResult
}
