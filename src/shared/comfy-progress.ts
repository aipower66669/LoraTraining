/** Prefer node _meta.title, else class_type — used when resolving WS node ids. */
export function formatComfyProgressLine(opts: {
  nodeTitle?: string | null
  step?: number | null
  max?: number | null
  detail?: string | null
}): string {
  const parts: string[] = []
  if (opts.nodeTitle) parts.push(opts.nodeTitle)
  if (
    opts.step != null &&
    opts.max != null &&
    Number.isFinite(opts.step) &&
    Number.isFinite(opts.max) &&
    opts.max > 0
  ) {
    parts.push(`${opts.step}/${opts.max}`)
  }
  if (opts.detail) parts.push(opts.detail)
  return parts.join(' · ')
}

export function comfyStepPercent(step?: number | null, max?: number | null): number | null {
  if (
    step == null ||
    max == null ||
    !Number.isFinite(step) ||
    !Number.isFinite(max) ||
    max <= 0
  ) {
    return null
  }
  return Math.min(100, Math.max(0, Math.round((step / max) * 100)))
}
