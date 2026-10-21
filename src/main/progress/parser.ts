import type { JobProgress } from '@shared/ipc/contract'
import {
  INITIAL_PROGRESS_ACTION,
  TRAINING_PROGRESS_ACTION,
  parseActionLabel,
  looksLikeTqdmLine
} from '@shared/progress-action'

const STEP_RE =
  /(?:step|Step|iteration|Iteration)\s*[:=]?\s*(\d+)(?:\s*\/\s*(\d+))?/i
const LOSS_RE = /loss\s*[=:]\s*([0-9.eE+-]+)/i
const LR_RE = /(?:\blr\b|learning[\s_]?rate)\s*[=:]\s*([0-9.eE+-]+)/i
const SIT_RE = /([0-9.]+)\s*s\/it/i
const ITS_RE = /([0-9.]+)\s*it\/s/i
const PASS_RE = /(?:\bpass\b|\bepoch\b)\s*[:=]?\s*(\d+)/i
/** AI Toolkit / tqdm: `4%|…| 105/3000 [05:24<2:29:08, 3.09s/it, …]` (percent in log ignored). */
const TQDM_RE =
  /\d+(?:\.\d+)?%\s*\|([^|]*)\|\s*(\d+)\s*\/\s*(\d+)\s*\[\s*([0-9:]+)\s*<\s*([0-9:]+)/
/** Bare `105/3000` near a tqdm rate (fallback). */
const BARE_STEP_RE = /(\d+)\s*\/\s*(\d+)(?=\s*\[)/

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '')
}

/** Parse tqdm time `H:MM:SS` / `MM:SS` / `SS` → milliseconds. */
export function parseTqdmDuration(text: string): number | undefined {
  const parts = text.trim().split(':').map((p) => Number(p))
  if (parts.length === 0 || parts.some((n) => Number.isNaN(n))) return undefined
  if (parts.length === 3) {
    return ((parts[0]! * 60 + parts[1]!) * 60 + parts[2]!) * 1000
  }
  if (parts.length === 2) {
    return (parts[0]! * 60 + parts[1]!) * 1000
  }
  return parts[0]! * 1000
}

/**
 * Middle segment between `%|` and `| steps` in ToolkitProgressBar output.
 * AI Toolkit leaves this as the tqdm bar; when ascii mode shows a short
 * numeric stub (`3          `), treat the leading integer as Pass/epoch
 * when it is a small whole number (not a filled `3333####` bar).
 */
export function parsePassFromTqdmBar(barSegment: string): number | undefined {
  const trimmed = barSegment.replace(/\s+$/g, '')
  // Pure small integer + optional trailing spaces only (e.g. "3" or "12").
  const m = trimmed.match(/^\s*(\d{1,4})\s*$/)
  if (!m?.[1]) return undefined
  const n = Number(m[1])
  if (!Number.isFinite(n) || n < 0) return undefined
  return n
}

export function createEmptyProgress(totalSteps?: number): JobProgress {
  return {
    totalSteps,
    elapsedMs: 0,
    pausedMs: 0,
    lastMessage: INITIAL_PROGRESS_ACTION,
    updatedAt: new Date().toISOString()
  }
}

export function parseMetricsLine(
  line: string,
  prev: JobProgress,
  startedAtMs: number
): JobProgress {
  const clean = stripAnsi(line).trim()
  if (!clean) return prev

  const next: JobProgress = { ...prev, updatedAt: new Date().toISOString() }
  next.elapsedMs = Math.max(0, Date.now() - startedAtMs - (prev.pausedMs || 0))

  const action = parseActionLabel(clean)
  if (action) {
    next.lastMessage = action
  } else if (
    looksLikeTqdmLine(clean) &&
    (LOSS_RE.test(clean) || LR_RE.test(clean)) &&
    (prev.lastMessage == null ||
      looksLikeTqdmLine(prev.lastMessage) ||
      prev.lastMessage === INITIAL_PROGRESS_ACTION)
  ) {
    // Training tqdm without a stars banner (or stale raw line in lastMessage).
    next.lastMessage = TRAINING_PROGRESS_ACTION
  } else if (prev.lastMessage && looksLikeTqdmLine(prev.lastMessage)) {
    // Drop corrupted/stale tqdm text left in lastMessage.
    next.lastMessage = TRAINING_PROGRESS_ACTION
  }

  const tqdm = clean.match(TQDM_RE)
  if (tqdm) {
    const passFromBar = parsePassFromTqdmBar(tqdm[1] ?? '')
    if (passFromBar !== undefined) next.pass = passFromBar
    next.currentStep = Number(tqdm[2])
    next.totalSteps = Number(tqdm[3])
    const eta = parseTqdmDuration(tqdm[5] ?? '')
    if (eta !== undefined) next.etaMs = eta
  } else {
    const bare = clean.match(BARE_STEP_RE)
    if (bare?.[1] && bare[2]) {
      next.currentStep = Number(bare[1])
      next.totalSteps = Number(bare[2])
    }
  }

  const stepMatch = clean.match(STEP_RE)
  if (stepMatch?.[1]) {
    next.currentStep = Number(stepMatch[1])
    if (stepMatch[2]) next.totalSteps = Number(stepMatch[2])
  }

  const passMatch = clean.match(PASS_RE)
  if (passMatch?.[1]) next.pass = Number(passMatch[1])

  const lossMatch = clean.match(LOSS_RE)
  if (lossMatch?.[1]) next.loss = Number(lossMatch[1])

  const lrMatch = clean.match(LR_RE)
  if (lrMatch?.[1]) next.learningRate = Number(lrMatch[1])

  const sit = clean.match(SIT_RE)
  if (sit?.[1]) {
    next.secondsPerStep = Number(sit[1])
    next.avgStepMs = next.secondsPerStep * 1000
    next.stepsPerSecond = next.secondsPerStep > 0 ? 1 / next.secondsPerStep : undefined
  }
  const its = clean.match(ITS_RE)
  if (its?.[1]) {
    next.stepsPerSecond = Number(its[1])
    next.secondsPerStep = next.stepsPerSecond > 0 ? 1 / next.stepsPerSecond : undefined
    next.avgStepMs = next.secondsPerStep !== undefined ? next.secondsPerStep * 1000 : undefined
  }

  // Always derive % from steps (1 decimal); ignore tqdm's printed integer percent.
  if (next.currentStep !== undefined && next.totalSteps && next.totalSteps > 0) {
    next.percent = Math.min(100, (next.currentStep / next.totalSteps) * 100)
  }

  // Prefer tqdm's remaining time; otherwise estimate from rate.
  if (
    next.etaMs === undefined &&
    next.currentStep !== undefined &&
    next.totalSteps &&
    next.avgStepMs !== undefined
  ) {
    next.etaMs = Math.max(0, next.totalSteps - next.currentStep) * next.avgStepMs
  }

  return next
}
