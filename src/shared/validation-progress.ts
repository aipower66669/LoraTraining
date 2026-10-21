import type { CheckpointEntry } from '@shared/ipc/contract'

export type SetPreviewProgress = {
  setLabel: string
  done: number
  total: number
  /** 0–100 */
  percent: number
}

/** How many included checkpoints already have a preview image in the given set folder. */
export function countSetPreviewProgress(
  checkpoints: CheckpointEntry[],
  setLabel: string
): SetPreviewProgress {
  const included = checkpoints.filter((cp) => cp.keepInComfy !== false)
  const total = included.length
  const done = included.filter((cp) =>
    cp.validationImages.some((img) => img.setLabel === setLabel)
  ).length
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)
  return { setLabel, done, total, percent }
}

export function formatSetPreviewProgress(p: SetPreviewProgress): string {
  if (p.total === 0) return 'No checkpoints'
  return `${p.done} / ${p.total} · ${p.percent}%`
}
