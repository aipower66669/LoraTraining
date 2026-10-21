import { unwrap } from '../store'

/**
 * Reveal a job’s dataset on disk: dataset root when training hasn’t produced
 * checkpoints yet; `{dataset}/output` once checkpoints exist.
 */
export async function revealJobFolder(opts: {
  datasetId: string
  /** True when the job has saved checkpoints (`checkpointStep > 0`). */
  hasCheckpoints: boolean
}): Promise<'output' | 'dataset'> {
  if (opts.hasCheckpoints) {
    try {
      unwrap(await window.loraTraining.datasets.openFolder(opts.datasetId, 'output'))
      return 'output'
    } catch {
      /* output missing — fall back to dataset root */
    }
  }
  unwrap(await window.loraTraining.datasets.openFolder(opts.datasetId))
  return 'dataset'
}
