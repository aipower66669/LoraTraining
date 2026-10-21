import type { JoyCaptionExistingMode } from './joycaption'

/** Live progress for a JoyCaption (or similar) captioning run / queue session. */
export interface CaptionRunProgress {
  runId: string
  datasetId: string
  status: 'running' | 'complete' | 'failed' | 'cancelled'
  /**
   * Images across the whole caption session (active job + pending jobs).
   * Footer progress uses this aggregate.
   */
  total: number
  /** Successfully written captions so far this session. */
  completed: number
  /** Image currently being captioned (file name in dataset folder). */
  currentFileName: string | null
  /** Last image that got a caption written. */
  lastCompletedFileName: string | null
  /** All images captioned so far this run (basenames / dataset file names). */
  completedFileNames?: string[]
  /**
   * Active job: remaining images still to process (current first, then waiting).
   * Used by the status-bar queue popover.
   */
  remainingFileNames?: string[]
  /** Jobs still waiting after the active one. */
  pendingJobs?: number
  /** Summaries of jobs waiting after the active one (for the queue popover). */
  pendingJobSummaries?: CaptionPendingJobSummary[]
  message?: string
}

/** One waiting JoyCaption job (dataset-level, files not resolved until it starts). */
export interface CaptionPendingJobSummary {
  runId: string
  datasetId: string
  mode: JoyCaptionExistingMode
  plannedTotal: number
  prependTrigger: boolean
}

export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '')
}

/** Parse JoyCaption `[OK] path -> caption.txt` lines. Returns basename of the image. */
export function parseCaptionOkLine(line: string): string | null {
  const clean = stripAnsi(line).trim()
  const m = clean.match(/^\[OK\]\s+(.+?)\s+->\s+\S+/i)
  if (!m?.[1]) return null
  const pathPart = m[1].replace(/\\/g, '/')
  const base = pathPart.split('/').filter(Boolean).pop()
  return base || null
}

export function parseCaptionToProcessLine(line: string): number | null {
  const clean = stripAnsi(line).trim()
  const m = clean.match(/^To process\s*:\s*(\d+)/i)
  return m ? Number(m[1]) : null
}

/** Status line: Processing X of N (M%) · optionally “K queued”. */
export function formatCaptionProgressStatus(p: CaptionRunProgress): string {
  const queuedSuffix =
    p.status === 'running' && (p.pendingJobs ?? 0) > 0
      ? ` · ${p.pendingJobs} queued`
      : ''

  if (p.status === 'complete') {
    return `Captioning complete · ${p.completed} of ${p.total} (100%)`
  }
  if (p.status === 'failed') {
    return p.message
      ? `Captioning failed · ${p.message}`
      : `Captioning failed · ${p.completed} of ${p.total}`
  }
  if (p.status === 'cancelled') {
    return `Captioning cancelled · ${p.completed} of ${p.total}`
  }
  if (p.total <= 0) {
    return `Captioning…${queuedSuffix}`
  }
  const x = Math.min(Math.max(p.completed + (p.currentFileName ? 1 : 0), p.completed), p.total) || 1
  const pct = Math.min(100, Math.round((p.completed / p.total) * 100))
  return `Processing ${x} of ${p.total} (${pct}%)${queuedSuffix}`
}
