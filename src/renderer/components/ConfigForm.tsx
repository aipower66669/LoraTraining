import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import type { TrainingConfig } from '@shared/schemas/training-config'

const SECTIONS_STORAGE_KEY = 'lora-training:config-form-open-sections'

const SECTION_DEFAULTS = {
  job: true,
  network: true,
  save: false,
  dataset: true,
  train: true,
  sample: false
} as const

type SectionId = keyof typeof SECTION_DEFAULTS

function readOpenSections(): Record<SectionId, boolean> {
  const defaults = { ...SECTION_DEFAULTS }
  try {
    const raw = localStorage.getItem(SECTIONS_STORAGE_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaults
    const out: Record<SectionId, boolean> = { ...defaults }
    for (const id of Object.keys(SECTION_DEFAULTS) as SectionId[]) {
      const v = (parsed as Record<string, unknown>)[id]
      if (typeof v === 'boolean') out[id] = v
    }
    return out
  } catch {
    return defaults
  }
}

function writeOpenSections(open: Record<SectionId, boolean>): void {
  try {
    localStorage.setItem(SECTIONS_STORAGE_KEY, JSON.stringify(open))
  } catch {
    /* ignore */
  }
}

/** Optimizer type strings accepted by ostris/ai-toolkit `get_optimizer`. */
const AI_TOOLKIT_OPTIMIZERS = [
  { value: 'adamw8bit', label: 'AdamW 8-bit (bitsandbytes) — recommended low VRAM' },
  { value: 'adam8bit', label: 'Adam 8-bit (bitsandbytes)' },
  { value: 'ademamix8bit', label: 'AdEMAMix 8-bit (bitsandbytes)' },
  { value: 'lion8bit', label: 'Lion 8-bit (bitsandbytes)' },
  { value: 'adamw8', label: 'AdamW 8-bit (toolkit)' },
  { value: 'adam8', label: 'Adam 8-bit (toolkit)' },
  { value: 'prodigy8bit', label: 'Prodigy 8-bit' },
  { value: 'prodigy', label: 'Prodigy' },
  { value: 'adamw', label: 'AdamW' },
  { value: 'adam', label: 'Adam' },
  { value: 'lion', label: 'Lion' },
  { value: 'adafactor', label: 'Adafactor' },
  { value: 'adagrad', label: 'Adagrad' },
  { value: 'automagic', label: 'Automagic' },
  { value: 'automagic2', label: 'Automagic 2' },
  { value: 'automagic3', label: 'Automagic 3' },
  { value: 'dadaptation', label: 'DAdaptation (legacy)' }
] as const

/** Save / train dtype values used by AI Toolkit UI (`bf16` / `fp16` / `fp32`). */
const AI_TOOLKIT_DTYPES = [
  { value: 'bf16', label: 'BF16' },
  { value: 'fp16', label: 'FP16' },
  { value: 'fp32', label: 'FP32' }
] as const

export type ConfigDatasetOption = {
  id: string
  name: string
  folderPath: string
}

type Props = {
  value: TrainingConfig
  onChange: (next: TrainingConfig) => void
  readOnlyPaths?: boolean
  /** Disable all fields (e.g. while the job is training). */
  disabled?: boolean
  /**
   * Lock identity / dataset fields that must not change after a job has left draft
   * (LoRA name, trigger, dataset, resolution, dtype, network, …).
   * Train hyperparameters like steps/LR stay editable unless `disabled`.
   */
  lockIdentityFields?: boolean
  /**
   * Lock only LoRA name, trigger, and dataset picker/folder — used for multi-job
   * edit where other training fields can still be bulk-applied.
   */
  lockPerJobFields?: boolean
  /** Hide process `name` when the parent screen owns the job display name. */
  hideName?: boolean
  /**
   * When set, shows a button next to LoRA name that applies the suggested default
   * (existing output stem, else Category_Dataset).
   */
  onSuggestLoraName?: () => void | Promise<void>
  /** When set, Dataset folder path becomes a Ready-dataset dropdown. */
  datasetSelect?: {
    options: ConfigDatasetOption[]
    value: string
    onChange: (datasetId: string) => void
  }
}

function update<K extends keyof TrainingConfig>(
  value: TrainingConfig,
  key: K,
  patch: TrainingConfig[K]
): TrainingConfig {
  return { ...value, [key]: patch }
}

function Check(props: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  children: string
}): React.JSX.Element {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled === true}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span>{props.children}</span>
    </label>
  )
}

export function ConfigForm({
  value,
  onChange,
  readOnlyPaths,
  disabled,
  lockIdentityFields,
  lockPerJobFields,
  hideName,
  onSuggestLoraName,
  datasetSelect
}: Props): React.JSX.Element {
  const ds = value.datasets[0]
  const identityLocked = disabled === true || lockIdentityFields === true
  const perJobLocked =
    disabled === true || lockIdentityFields === true || lockPerJobFields === true

  const optimizerValues = AI_TOOLKIT_OPTIMIZERS.map((o) => o.value as string)
  const optimizerOptions =
    optimizerValues.includes(value.train.optimizer)
      ? AI_TOOLKIT_OPTIMIZERS
      : [
          { value: value.train.optimizer, label: `${value.train.optimizer} (custom)` },
          ...AI_TOOLKIT_OPTIMIZERS
        ]

  const [openSections, setOpenSections] = useState(readOpenSections)

  function setSectionOpen(id: SectionId, open: boolean): void {
    setOpenSections((prev) => {
      if (prev[id] === open) return prev
      const next = { ...prev, [id]: open }
      writeOpenSections(next)
      return next
    })
  }

  return (
    <fieldset className="config-form-fieldset" disabled={disabled === true}>
      <div className="form-grid">
      <details
        className="collapsible"
        open={openSections.job}
        onToggle={(e) => setSectionOpen('job', e.currentTarget.open)}
      >
        <summary className="section-title">Job / process</summary>
        <div className="form-row">
          {!hideName ? (
            <label className="config-lora-name-field">
              LoRA name
              <span className="config-lora-name-row">
                <input
                  className="mono"
                  value={value.name}
                  disabled={perJobLocked}
                  onChange={(e) => onChange(update(value, 'name', e.target.value))}
                  title="Checkpoint stem: {name}_NNNNNNNNN.safetensors"
                />
                {onSuggestLoraName ? (
                  <button
                    type="button"
                    className="icon-btn"
                    title="Set default LoRA name (existing output stem, or Category_Dataset)"
                    aria-label="Set default LoRA name"
                    disabled={perJobLocked}
                    onClick={() => void onSuggestLoraName()}
                  >
                    <Sparkles size={14} strokeWidth={2} aria-hidden="true" />
                  </button>
                ) : null}
              </span>
            </label>
          ) : null}
          <label>
            Device
            <input
              className="mono"
              value={value.device}
              disabled={identityLocked}
              onChange={(e) => onChange(update(value, 'device', e.target.value))}
            />
          </label>
        </div>
        <div className="form-row">
          <label>
            Trigger word
            <input
              className="mono"
              value={value.trigger_word}
              disabled={perJobLocked}
              onChange={(e) => onChange(update(value, 'trigger_word', e.target.value))}
              title="With cache_text_embeddings enabled, put the trigger in captions — do not rely on trigger_word injection."
            />
          </label>
        </div>
      </details>

      <details
        className="collapsible"
        open={openSections.network}
        onToggle={(e) => setSectionOpen('network', e.currentTarget.open)}
      >
        <summary className="section-title">Network</summary>
        <div className="form-row">
          <label>
            Rank (linear)
            <input
              type="number"
              value={value.network.linear}
              disabled={identityLocked}
              onChange={(e) =>
                onChange(
                  update(value, 'network', {
                    ...value.network,
                    linear: Number(e.target.value)
                  })
                )
              }
            />
          </label>
          <label>
            Alpha
            <input
              type="number"
              value={value.network.linear_alpha}
              disabled={identityLocked}
              onChange={(e) =>
                onChange(
                  update(value, 'network', {
                    ...value.network,
                    linear_alpha: Number(e.target.value)
                  })
                )
              }
            />
          </label>
        </div>
      </details>

      <details
        className="collapsible"
        open={openSections.save}
        onToggle={(e) => setSectionOpen('save', e.currentTarget.open)}
      >
        <summary className="section-title">Save</summary>
        <div className="form-row">
          <label>
            Save every
            <input
              type="number"
              value={value.save.save_every}
              onChange={(e) =>
                onChange(
                  update(value, 'save', { ...value.save, save_every: Number(e.target.value) })
                )
              }
            />
          </label>
          <label>
            Data Type
            <select
              value={value.save.dtype}
              disabled={identityLocked}
              onChange={(e) => {
                const dtype = e.target.value
                onChange({
                  ...value,
                  save: { ...value.save, dtype },
                  train: { ...value.train, dtype }
                })
              }}
            >
              {AI_TOOLKIT_DTYPES.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
              {!AI_TOOLKIT_DTYPES.some((d) => d.value === value.save.dtype) && (
                <option value={value.save.dtype}>{value.save.dtype} (custom)</option>
              )}
            </select>
          </label>
        </div>
      </details>

      <details
        className="collapsible"
        open={openSections.dataset}
        onToggle={(e) => setSectionOpen('dataset', e.currentTarget.open)}
      >
        <summary className="section-title">Dataset</summary>
        {ds && (
          <>
            <label>
              {datasetSelect ? 'Dataset' : 'Folder path'}
              {datasetSelect ? (
                <select
                  value={datasetSelect.value}
                  disabled={readOnlyPaths || perJobLocked}
                  onChange={(e) => datasetSelect.onChange(e.target.value)}
                >
                  {datasetSelect.options.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.name}
                    </option>
                  ))}
                  {!datasetSelect.options.some((o) => o.id === datasetSelect.value) ? (
                    <option value={datasetSelect.value}>
                      Current dataset (not Ready)
                    </option>
                  ) : null}
                </select>
              ) : (
                <input
                  className="mono"
                  value={ds.folder_path}
                  disabled={readOnlyPaths || perJobLocked}
                  onChange={(e) => {
                    const datasets = [...value.datasets]
                    datasets[0] = { ...ds, folder_path: e.target.value }
                    onChange({ ...value, datasets })
                  }}
                />
              )}
            </label>
            <div className="form-row">
              <label>
                Resolution (comma)
                <input
                  className="mono"
                  value={ds.resolution.join(',')}
                  disabled={identityLocked}
                  onChange={(e) => {
                    const resolution = e.target.value
                      .split(',')
                      .map((x) => Number(x.trim()))
                      .filter((n) => !Number.isNaN(n))
                    const datasets = [...value.datasets]
                    datasets[0] = { ...ds, resolution }
                    onChange({ ...value, datasets })
                  }}
                />
              </label>
              <label>
                Caption dropout
                <input
                  type="number"
                  step="0.01"
                  value={ds.caption_dropout_rate}
                  disabled={identityLocked}
                  onChange={(e) => {
                    const datasets = [...value.datasets]
                    datasets[0] = { ...ds, caption_dropout_rate: Number(e.target.value) }
                    onChange({ ...value, datasets })
                  }}
                />
              </label>
            </div>
            <div className="form-row check-row">
              <Check
                checked={ds.cache_latents_to_disk}
                disabled={identityLocked}
                onChange={(checked) => {
                  const datasets = [...value.datasets]
                  datasets[0] = { ...ds, cache_latents_to_disk: checked }
                  onChange({ ...value, datasets })
                }}
              >
                Cache latents to disk
              </Check>
              <Check
                checked={ds.shuffle_tokens}
                disabled={identityLocked}
                onChange={(checked) => {
                  const datasets = [...value.datasets]
                  datasets[0] = { ...ds, shuffle_tokens: checked }
                  onChange({ ...value, datasets })
                }}
              >
                Shuffle tokens
              </Check>
            </div>
          </>
        )}
      </details>

      <details
        className="collapsible"
        open={openSections.train}
        onToggle={(e) => setSectionOpen('train', e.currentTarget.open)}
      >
        <summary className="section-title">Train</summary>
        <div className="form-row">
          <label>
            Steps
            <input
              type="number"
              value={typeof value.train.steps === 'number' ? value.train.steps : 2000}
              onChange={(e) =>
                onChange(
                  update(value, 'train', { ...value.train, steps: Number(e.target.value) })
                )
              }
            />
          </label>
          <label>
            Learning rate
            <input
              className="mono"
              type="number"
              step="any"
              value={value.train.lr}
              onChange={(e) =>
                onChange(update(value, 'train', { ...value.train, lr: Number(e.target.value) }))
              }
            />
          </label>
        </div>
        <div className="form-row">
          <label>
            Batch size
            <input
              type="number"
              value={value.train.batch_size}
              onChange={(e) =>
                onChange(
                  update(value, 'train', { ...value.train, batch_size: Number(e.target.value) })
                )
              }
            />
          </label>
          <label>
            Optimizer
            <select
              value={value.train.optimizer}
              onChange={(e) =>
                onChange(update(value, 'train', { ...value.train, optimizer: e.target.value }))
              }
            >
              {optimizerOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-row check-row">
          <Check
            checked={value.train.cache_text_embeddings}
            disabled={identityLocked}
            onChange={(checked) =>
              onChange(
                update(value, 'train', {
                  ...value.train,
                  cache_text_embeddings: checked
                })
              )
            }
          >
            Cache text embeddings
          </Check>
          <Check
            checked={value.train.gradient_checkpointing}
            onChange={(checked) =>
              onChange(
                update(value, 'train', {
                  ...value.train,
                  gradient_checkpointing: checked
                })
              )
            }
          >
            Gradient checkpointing
          </Check>
        </div>
        <div className="form-row check-row">
          <Check
            checked={value.train.disable_sampling}
            onChange={(checked) =>
              onChange(
                update(value, 'train', {
                  ...value.train,
                  disable_sampling: checked
                })
              )
            }
          >
            Disable sampling
          </Check>
          <Check
            checked={value.train.skip_first_sample}
            onChange={(checked) =>
              onChange(
                update(value, 'train', {
                  ...value.train,
                  skip_first_sample: checked
                })
              )
            }
          >
            Skip first sample
          </Check>
        </div>
      </details>

      <details
        className="collapsible"
        open={openSections.sample}
        onToggle={(e) => setSectionOpen('sample', e.currentTarget.open)}
      >
        <summary className="section-title">Sample</summary>
        <label>
          Prompts (one per line)
          <textarea
            value={value.sample.prompts.join('\n')}
            onChange={(e) =>
              onChange(
                update(value, 'sample', {
                  ...value.sample,
                  prompts: e.target.value.split(/\r?\n/).filter(Boolean)
                })
              )
            }
          />
        </label>
      </details>
      </div>
    </fieldset>
  )
}
