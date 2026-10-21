import { FileSearch } from 'lucide-react'
import type { TrainingConfig } from '@shared/schemas/training-config'

/**
 * Krea 2 architecture variants supported by LoraTraining (via AI Toolkit).
 */
const KREA2_ARCHITECTURES: Array<{ value: string; label: string }> = [
  { value: 'krea2', label: 'Krea 2 (raw)' },
  { value: 'krea2:turbo', label: 'Krea 2 Turbo (w/ Training Adapter)' },
  { value: 'krea2:o_edit', label: 'Krea 2 (raw) [Edit Training]' },
  { value: 'krea2:o_edit_turbo', label: 'Krea 2 Turbo (w/ Training Adapter) [Edit Training]' }
]

function percentFromUnit(unit: number): number {
  const pct = Math.round(unit * 100)
  return Math.max(0, Math.min(100, Math.round(pct / 5) * 5))
}

export function TrainingModelFields(props: {
  value: TrainingConfig['model']
  onChange: (next: TrainingConfig['model']) => void
  /** Browse button for checkpoint path (Settings). */
  onBrowseCheckpoint?: () => void
}): React.JSX.Element {
  const { value, onChange } = props
  const offloadPct = value.layer_offloading
    ? percentFromUnit(value.layer_offloading_transformer_percent)
    : 0

  return (
    <div className="form-grid">
      <label>
        Checkpoint path
        <span className="config-lora-name-row">
          <input
            className="mono"
            value={value.name_or_path}
            onChange={(e) => onChange({ ...value, name_or_path: e.target.value })}
          />
          {props.onBrowseCheckpoint ? (
            <button
              type="button"
              className="icon-btn path-browse-btn"
              title="Browse for checkpoint"
              aria-label="Browse for checkpoint"
              onClick={() => props.onBrowseCheckpoint?.()}
            >
              <FileSearch size={14} strokeWidth={2} aria-hidden="true" />
            </button>
          ) : null}
        </span>
      </label>
      <div className="form-row">
        <label>
          Architecture
          <select
            value={value.arch}
            onChange={(e) => onChange({ ...value, arch: e.target.value })}
          >
            {KREA2_ARCHITECTURES.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
            {!KREA2_ARCHITECTURES.some((a) => a.value === value.arch) && (
              <option value={value.arch}>{value.arch} (unsupported — pick Krea 2)</option>
            )}
          </select>
        </label>
        <div className="form-row check-row" style={{ alignContent: 'end' }}>
          <label className="check">
            <input
              type="checkbox"
              checked={value.low_vram}
              onChange={(e) => onChange({ ...value, low_vram: e.target.checked })}
            />
            <span>Low VRAM</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={value.quantize}
              onChange={(e) => onChange({ ...value, quantize: e.target.checked })}
            />
            <span>Quantize</span>
          </label>
        </div>
      </div>
      <label
        className="slider-field"
        title="Percent of transformer layers offloaded to CPU/RAM. 0% disables offloading."
      >
        <span className="slider-heading">
          Layer offloading
          <span className="mono slider-value">{offloadPct}%</span>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={offloadPct}
          onChange={(e) => {
            const pct = Number(e.target.value)
            onChange({
              ...value,
              layer_offloading: pct > 0,
              layer_offloading_transformer_percent: pct / 100
            })
          }}
        />
      </label>
    </div>
  )
}
