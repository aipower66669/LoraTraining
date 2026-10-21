import { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { VALIDATION_MODEL_DEFAULT } from '@shared/validation-model'
import { pruneModelsToAvailable } from '@shared/stress-sets'
import { useComfyModels } from '../hooks/useComfyModels'

/** Display label: drop redundant weight extensions (stored value stays full). */
function displayModelName(name: string): string {
  return name.replace(/\.(safetensors|ckpt|pt|pth|bin|gguf)$/i, '')
}

export function ComfyModelMultiSelectDialog(props: {
  open: boolean
  selected: string[]
  onCancel: () => void
  onConfirm: (models: string[]) => void
  /** Persist after auto-dropping models Comfy no longer lists. */
  onPruned?: (kept: string[], removed: string[]) => void
}): React.JSX.Element | null {
  const { models, loading, error, refresh } = useComfyModels(props.open)
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(props.selected))
  const prunedKeyRef = useRef<string>('')

  useEffect(() => {
    if (props.open) {
      setTicked(new Set(props.selected))
      prunedKeyRef.current = ''
    }
  }, [props.open, props.selected])

  // Models deleted from Comfy stay stuck in the saved tick list — drop them.
  useEffect(() => {
    if (!props.open || loading || error || models.length === 0) return
    const { kept, removed } = pruneModelsToAvailable(props.selected, models)
    if (removed.length === 0) return
    const key = removed.slice().sort().join('\0')
    if (prunedKeyRef.current === key) return
    prunedKeyRef.current = key
    setTicked(new Set(kept))
    props.onPruned?.(kept, removed)
  }, [props.open, props.selected, props.onPruned, models, loading, error])

  const allNames = useMemo(() => {
    return [...new Set(models.filter((m) => m && m !== VALIDATION_MODEL_DEFAULT))].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    )
  }, [models])

  if (!props.open) return null

  function toggle(name: string): void {
    setTicked((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={props.onCancel}>
      <div
        className="modal stress-models-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Select models for stress-testing"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginTop: 0 }}>Models to stress-test</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          Tick every ComfyUI checkpoint / UNET this set should generate against the chosen LoRA.
          Apply also saves the list as the default for new stress sets. Models no longer in Comfy
          are removed automatically.
        </p>
        <div className="toolbar" style={{ marginBottom: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={loading || allNames.length === 0}
            onClick={() => setTicked(new Set(allNames))}
          >
            Select All
          </button>
          <button type="button" disabled={ticked.size === 0} onClick={() => setTicked(new Set())}>
            Unselect All
          </button>
          <button
            type="button"
            className="icon-btn"
            title={error ? `Refresh — ${error}` : 'Refresh model list from ComfyUI'}
            aria-label="Refresh model list"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <RefreshCw size={14} strokeWidth={2} aria-hidden="true" />
          </button>
          <span className="hint" style={{ marginLeft: 'auto' }}>
            {ticked.size} selected
            {loading ? ' · loading…' : ''}
          </span>
        </div>
        {error ? <div className="error-banner">{error}</div> : null}
        <div className="modal-body stress-models-list">
          {allNames.length === 0 && !loading ? (
            <p className="hint">No models listed. Start ComfyUI and refresh.</p>
          ) : (
            <ul className="stress-models-ul">
              {allNames.map((name) => {
                const checked = ticked.has(name)
                const label = displayModelName(name)
                return (
                  <li key={name}>
                    <label className="check" title={name}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(name)}
                      />
                      <span className="mono">{label}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" onClick={props.onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={() =>
              props.onConfirm(pruneModelsToAvailable(allNames.filter((n) => ticked.has(n)), models).kept)
            }
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
