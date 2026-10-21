import type { JobProgress } from '@shared/ipc/contract'
import type { LucideIcon } from 'lucide-react'
import { Gauge, Hash, Hourglass, Percent, Timer } from 'lucide-react'

export function formatProgressMs(ms?: number): string {
  if (ms === undefined || Number.isNaN(ms)) return '—'
  const s = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(s / 60)
  const rem = s % 60
  if (m > 60) {
    const h = Math.floor(m / 60)
    return `${h}h ${m % 60}m`
  }
  return m > 0 ? `${m}m ${rem}s` : `${rem}s`
}

export function progressPercent(p: JobProgress | null | undefined): number {
  if (!p?.currentStep || p.totalSteps === undefined || p.totalSteps <= 0) return 0
  return Math.min(100, (p.currentStep / p.totalSteps) * 100)
}

export function formatProgressRate(p: JobProgress | null | undefined): string {
  if (p?.secondsPerStep !== undefined && p.secondsPerStep >= 0.1) {
    return `${p.secondsPerStep.toFixed(2)} s/it`
  }
  if (p?.stepsPerSecond !== undefined) {
    return `${p.stepsPerSecond.toFixed(2)} it/s`
  }
  return '—'
}

function MetricCell(props: {
  icon: LucideIcon
  label: string
  value: string
}): React.JSX.Element {
  const Icon = props.icon
  return (
    <div className="metric" title={props.label}>
      <Icon className="metric-icon" size={14} strokeWidth={2} aria-hidden="true" />
      <span className="value" aria-label={props.label}>
        {props.value}
      </span>
    </div>
  )
}

/** Compact metric cards matching the Queue Progress panel (and global queue drawer). */
export function TrainingMetrics(props: {
  progress: JobProgress | null
  /** Tighter padding for the global queue drawer. */
  compact?: boolean
}): React.JSX.Element {
  const p = props.progress
  const percent = progressPercent(p)
  return (
    <div className={`metrics${props.compact ? ' metrics-compact' : ''}`}>
      <MetricCell
        icon={Percent}
        label="Progress"
        value={p ? `${percent.toFixed(1)}%` : '—'}
      />
      <MetricCell
        icon={Hash}
        label="Step"
        value={`${p?.currentStep ?? '—'} / ${p?.totalSteps ?? '—'}`}
      />
      <MetricCell icon={Timer} label="Elapsed" value={formatProgressMs(p?.elapsedMs)} />
      <MetricCell icon={Hourglass} label="ETA" value={formatProgressMs(p?.etaMs)} />
      <MetricCell icon={Gauge} label="Rate" value={formatProgressRate(p)} />
    </div>
  )
}
