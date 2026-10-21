import { RefreshCw } from 'lucide-react'
import { VALIDATION_MODEL_DEFAULT } from '@shared/validation-model'
import { useComfyModels } from '../hooks/useComfyModels'

export function ComfyModelSelect(props: {
  value: string
  onChange: (next: string) => void
  /** Include leading “Default” option (dataset override). */
  includeDefault?: boolean
  disabled?: boolean
  title?: string
  /** Hide status text under the control (for tight toolbars). */
  compact?: boolean
}): React.JSX.Element {
  const { models, loading, error, refresh } = useComfyModels(true)
  const value = props.value.trim() || (props.includeDefault ? VALIDATION_MODEL_DEFAULT : '')
  const extras: string[] = []
  if (value && value !== VALIDATION_MODEL_DEFAULT && !models.includes(value)) {
    extras.push(value)
  }

  return (
    <div className={`comfy-model-select${props.compact ? ' compact' : ''}`}>
      <select
        value={value}
        disabled={props.disabled || loading}
        title={error ? error : props.title}
        aria-label={props.title ?? 'Model'}
        onChange={(e) => props.onChange(e.target.value)}
      >
        {props.includeDefault ? (
          <option value={VALIDATION_MODEL_DEFAULT}>Default</option>
        ) : (
          <option value="">— not set —</option>
        )}
        {extras.map((m) => (
          <option key={`extra:${m}`} value={m}>
            {m} (not in list)
          </option>
        ))}
        {models.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="icon-btn comfy-model-refresh"
        title={error ? `Refresh model list — ${error}` : 'Refresh model list from ComfyUI'}
        aria-label="Refresh model list from ComfyUI"
        disabled={loading}
        onClick={() => void refresh()}
      >
        <RefreshCw size={14} strokeWidth={2} aria-hidden="true" />
      </button>
      {!props.compact && error ? <span className="hint comfy-model-error">{error}</span> : null}
      {!props.compact && loading && !error ? (
        <span className="hint">Loading models…</span>
      ) : null}
    </div>
  )
}
