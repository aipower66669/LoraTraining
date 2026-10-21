import type { JobProgress } from '@shared/ipc/contract'

/** Fixed toolkit stdout markers → progress header label (order = match priority). */
export const PROGRESS_PHASE_MARKERS: ReadonlyArray<{ match: string; label: string }> = [
  { match: 'Quantizing transformer', label: 'Quantizing transformer' },
  { match: 'Loading weights', label: 'Loading weights' },
  { match: 'Preprocessing image dimensions', label: 'Preprocessing image dimensions' },
  { match: 'Caching latents to disk', label: 'Caching latents to disk' },
  { match: 'Caching text embeddings to disk', label: 'Caching text embeddings to disk' }
]

/** Stars banner that AI Toolkit prints when the training loop begins. */
export const TRAINING_START_MARKER = '***************************************'

export const INITIAL_PROGRESS_ACTION = 'Initializing'

export const TRAINING_PROGRESS_ACTION = 'Training'

const KNOWN_ACTIONS = new Set<string>([
  INITIAL_PROGRESS_ACTION,
  TRAINING_PROGRESS_ACTION,
  ...PROGRESS_PHASE_MARKERS.map((m) => m.label)
])

/** tqdm / progress-bar noise — never show these as the phase label. */
export function looksLikeTqdmLine(line: string): boolean {
  const clean = line.replace(/\u001b\[[0-9;]*m/g, '').trim()
  if (!clean) return false
  if (/\d+(?:\.\d+)?%\s*\|/.test(clean)) return true
  if (/\d+\s*\/\s*\d+\s*\[/.test(clean)) return true
  if (/\d+(?:\.\d+)?\s*(?:s\/it|it\/s)/i.test(clean) && /loss|lr/i.test(clean)) return true
  return false
}

/**
 * If this log line marks a known phase, return its label; otherwise null.
 * Never returns raw tqdm / metric lines.
 */
export function parseActionLabel(line: string): string | null {
  const clean = line.replace(/\u001b\[[0-9;]*m/g, '').trim()
  if (!clean || looksLikeTqdmLine(clean)) return null

  if (clean.includes(TRAINING_START_MARKER) || /^\*{20,}/.test(clean)) {
    return TRAINING_PROGRESS_ACTION
  }

  for (const { match, label } of PROGRESS_PHASE_MARKERS) {
    if (clean.includes(match)) return label
  }
  return null
}

/**
 * Header text: only known phase labels (Initializing, cache steps, Training).
 * Never surfaces raw stderr/tqdm — those belong in the metric cards / live log.
 */
export function formatProgressAction(p: JobProgress | null | undefined): string {
  const msg = p?.lastMessage?.trim() || ''
  if (!msg || looksLikeTqdmLine(msg)) return ''
  if (!KNOWN_ACTIONS.has(msg)) return ''
  return msg
}

/** True once AI Toolkit has entered the training loop (not cache / load / init). */
export function isTrainingProgressPhase(p: JobProgress | null | undefined): boolean {
  return formatProgressAction(p) === TRAINING_PROGRESS_ACTION
}
