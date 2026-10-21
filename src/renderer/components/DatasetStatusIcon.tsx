import { Box, CircleCheck, Flag, ListOrdered, ShieldCheck } from 'lucide-react'
import type { DatasetLifecycleStatus } from '@shared/ipc/contract'

const LABELS: Record<Exclude<DatasetLifecycleStatus, 'none'>, string> = {
  ready: 'Ready for training',
  queued: 'Job queued or training',
  trained: 'Training output available',
  validated: 'All validation sets complete (keep-in-Comfy checkpoints)',
  done: 'Marked Done — referenced in wildcards'
}

export function DatasetStatusIcon(props: {
  status: DatasetLifecycleStatus
  className?: string
}): React.JSX.Element | null {
  if (props.status === 'none') return null
  const label = LABELS[props.status]
  const Icon =
    props.status === 'ready'
      ? CircleCheck
      : props.status === 'queued'
        ? ListOrdered
        : props.status === 'trained'
          ? Box
          : props.status === 'validated'
            ? ShieldCheck
            : Flag
  return (
    <span
      className={`dataset-status-icon dataset-status-${props.status}${props.className ? ` ${props.className}` : ''}`}
      title={label}
      aria-label={label}
    >
      <Icon size={14} strokeWidth={2.25} aria-hidden="true" />
    </span>
  )
}
