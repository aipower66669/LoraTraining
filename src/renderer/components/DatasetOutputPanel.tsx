import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { CheckpointEntry, DatasetOutputs } from '@shared/ipc/contract'
import { isTypingTarget, wrapIndex } from '@shared/keyboard'
import { toolConfigFlags } from '@shared/tool-config'
import { unwrap, useAppStore } from '../store'
import { outputAssetRelativePath, useRevealInExplorerMenu } from './RevealInExplorerMenu'
import { StarRatingReadout } from './StarRating'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatShortDate(mtimeMs: number): string {
  return new Date(mtimeMs).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function DatasetOutputPanel(props: {
  datasetId: string
  selectedPath: string | null
  onSelect: (checkpoint: CheckpointEntry) => void
  refreshKey?: number
  /** Pending checkpoint rows are training plans and only apply when AI Toolkit is configured. */
  showPending?: boolean
  /** Local average patches before a full list refresh lands. */
  ratingPatch?: { stem: string; averageRating: number | null; ratingCount: number } | null
}): React.JSX.Element {
  const [outputs, setOutputs] = useState<DatasetOutputs | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [moveFor, setMoveFor] = useState<CheckpointEntry | null>(null)
  const [moveTarget, setMoveTarget] = useState('')
  const [subfolders, setSubfolders] = useState<string[]>([])
  const listRef = useRef<HTMLDivElement | null>(null)
  const setStatus = useAppStore((s) => s.setStatus)
  const setAppError = useAppStore((s) => s.setError)
  const settings = useAppStore((s) => s.settings)
  const comfyConfigured = useMemo(() => toolConfigFlags(settings).comfy, [settings])
  const { openRevealMenu, revealMenuEl } = useRevealInExplorerMenu(props.datasetId)

  const loadOutputs = useCallback(
    async (opts?: { quiet?: boolean }): Promise<void> => {
      if (!opts?.quiet) setLoading(true)
      setError(null)
      try {
        const next = unwrap(
          await window.loraTraining.datasets.listOutputs(props.datasetId)
        ) as DatasetOutputs
        setOutputs(next)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setOutputs(null)
      } finally {
        setLoading(false)
      }
    },
    [props.datasetId]
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void window.loraTraining.datasets.listOutputs(props.datasetId).then((r) => {
      if (cancelled) return
      try {
        setOutputs(unwrap(r) as DatasetOutputs)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setOutputs(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [props.datasetId, props.refreshKey])

  // Job create/update/enqueue changes pending further-training rows.
  useEffect(() => {
    return window.loraTraining.events.subscribe((event) => {
      if (event.type !== 'job-updated' && event.type !== 'queue-updated') return
      if (
        event.type === 'job-updated' &&
        event.payload.datasetId &&
        event.payload.datasetId !== props.datasetId
      ) {
        return
      }
      void loadOutputs({ quiet: true })
    })
  }, [props.datasetId, loadOutputs])

  async function refreshComfyLocations(): Promise<void> {
    setRefreshing(true)
    try {
      await loadOutputs({ quiet: true })
      setStatus('Refreshed Comfy LoRA locations')
    } catch (err) {
      setAppError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    const patch = props.ratingPatch
    if (!patch) return
    setOutputs((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        checkpoints: prev.checkpoints.map((cp) => {
          const stem = cp.fileName.replace(/\.safetensors$/i, '')
          if (stem !== patch.stem) return cp
          return {
            ...cp,
            averageRating: patch.averageRating,
            ratingCount: patch.ratingCount
          }
        })
      }
    })
  }, [props.ratingPatch])

  const selectedPath = props.selectedPath
  const onSelect = props.onSelect

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      if (e.altKey || e.ctrlKey || e.metaKey) return
      if (isTypingTarget(e.target)) return
      if (moveFor) return
      const checkpoints = (outputs?.checkpoints ?? []).filter((cp) => !cp.pending)
      if (checkpoints.length === 0) return
      e.preventDefault()
      const current = checkpoints.findIndex((cp) => cp.relativePath === selectedPath)
      const from = current >= 0 ? current : e.key === 'ArrowUp' ? 0 : -1
      const delta = e.key === 'ArrowDown' ? 1 : -1
      const next = checkpoints[wrapIndex(from + delta, checkpoints.length)]
      if (!next) return
      onSelect(next)
      requestAnimationFrame(() => {
        const active = listRef.current?.querySelector('.output-row.active') as HTMLElement | null
        active?.scrollIntoView({ block: 'nearest' })
      })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [moveFor, outputs?.checkpoints, selectedPath, onSelect])

  async function toggleKeepInComfy(
    cp: CheckpointEntry,
    keepInComfy: boolean,
    e: React.MouseEvent | React.ChangeEvent
  ): Promise<void> {
    e.stopPropagation()
    setOutputs((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        checkpoints: prev.checkpoints.map((row) =>
          row.relativePath === cp.relativePath
            ? { ...row, keepInComfy, comfyRelativeDir: keepInComfy ? row.comfyRelativeDir : null }
            : row
        )
      }
    })
    try {
      const result = unwrap(
        await window.loraTraining.datasets.setCheckpointKeepInComfy(
          props.datasetId,
          cp.fileName,
          keepInComfy,
          cp.relativePath
        )
      ) as {
        keepInComfy: boolean
        deletedFromComfy: boolean
        copiedToComfy: boolean
        comfyRelativeDir: string | null
        datasetComfyLoraSubfolder: string | null
        rediscovered: boolean
      }
      setOutputs((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          checkpoints: prev.checkpoints.map((row) =>
            row.relativePath === cp.relativePath
              ? {
                  ...row,
                  keepInComfy: result.keepInComfy,
                  comfyRelativeDir: result.comfyRelativeDir
                }
              : row
          )
        }
      })
      if (!keepInComfy && result.deletedFromComfy) {
        setStatus(`Removed ${cp.fileName} from LoRA folder`)
      } else if (!keepInComfy) {
        setStatus(`Excluded ${cp.fileName} (no copy found under LoRA folder)`)
      } else if (result.copiedToComfy && result.comfyRelativeDir) {
        setStatus(`Copied ${cp.fileName} → ${result.comfyRelativeDir}/`)
      } else if (result.rediscovered && result.comfyRelativeDir) {
        setStatus(`Found ${cp.fileName} in ${result.comfyRelativeDir}/`)
      } else if (result.comfyRelativeDir) {
        setStatus(`Using existing ${cp.fileName} in ${result.comfyRelativeDir}/`)
      } else {
        setStatus(`Included ${cp.fileName} for ComfyUI validation`)
      }
    } catch (err) {
      setOutputs((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          checkpoints: prev.checkpoints.map((row) =>
            row.relativePath === cp.relativePath
              ? { ...row, keepInComfy: cp.keepInComfy, comfyRelativeDir: cp.comfyRelativeDir }
              : row
          )
        }
      })
      setAppError(err instanceof Error ? err.message : String(err))
    }
  }

  async function openMove(cp: CheckpointEntry, e: React.MouseEvent): Promise<void> {
    e.stopPropagation()
    setMoveFor(cp)
    setMoveTarget(cp.comfyRelativeDir || '')
    try {
      const folders = unwrap(
        await window.loraTraining.datasets.listComfyLoraSubfolders()
      ) as string[]
      setSubfolders(folders)
    } catch (err) {
      setSubfolders([])
      setAppError(err instanceof Error ? err.message : String(err))
    }
  }

  async function confirmMove(): Promise<void> {
    if (!moveFor || !moveTarget.trim()) return
    try {
      const result = unwrap(
        await window.loraTraining.datasets.moveCheckpointInComfy(
          props.datasetId,
          moveFor.fileName,
          moveTarget.trim()
        )
      ) as { relativeDir: string; movedFile: boolean }
      setOutputs((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          checkpoints: prev.checkpoints.map((row) =>
            row.relativePath === moveFor.relativePath
              ? { ...row, comfyRelativeDir: result.relativeDir, keepInComfy: true }
              : row
          )
        }
      })
      setStatus(
        result.movedFile
          ? `Moved ${moveFor.fileName} → ${result.relativeDir}/`
          : `Set Comfy folder for ${moveFor.fileName} → ${result.relativeDir}/ (will stage there on next validation)`
      )
      setMoveFor(null)
    } catch (err) {
      setAppError(err instanceof Error ? err.message : String(err))
    }
  }

  if (loading) {
    return <div className="empty">Looking for training output…</div>
  }

  if (error) {
    return <div className="error-banner">{error}</div>
  }

  const checkpoints = (outputs?.checkpoints ?? []).filter(
    (cp) => props.showPending !== false || !cp.pending
  )
  const pendingCount = checkpoints.filter((cp) => cp.pending).length
  const onDiskCount = checkpoints.length - pendingCount
  if (checkpoints.length === 0) {
    return (
      <div className="empty output-empty">
        <p>{props.showPending === false ? 'No training output found' : 'Training not started'}</p>
        <p className="hint">
          {props.showPending === false ? (
            <>
              Configure AI Toolkit in Settings to create training jobs. Existing{' '}
              <span className="mono">.safetensors</span> files appear here automatically.
            </>
          ) : (
            <>
              Checkpoints will appear here after a job writes{' '}
              <span className="mono">.safetensors</span> files to the dataset output folder.
            </>
          )}
        </p>
        {outputs?.trainingFolder && (
          <p className="hint mono path-hint">{outputs.trainingFolder}</p>
        )}
      </div>
    )
  }

  const countHint =
    pendingCount > 0
      ? `${onDiskCount} on disk · ${pendingCount} pending`
      : `${checkpoints.length} checkpoint${checkpoints.length === 1 ? '' : 's'}`

  return (
    <div className="output-list" ref={listRef}>
      {revealMenuEl}
      <div className="output-list-toolbar">
        <div className="hint">
          {comfyConfigured
            ? `${countHint} · ↑↓ checkpoints · ←→ sets · tick = keep in ComfyUI / validate · Move places the file under models/loras`
            : `${countHint} · ↑↓ checkpoints · ←→ sets`}
        </div>
        {comfyConfigured ? (
          <button
            type="button"
            className="icon-btn"
            title="Rescan ComfyUI LoRA folder for moved checkpoints"
            aria-label="Refresh Comfy LoRA locations"
            disabled={loading || refreshing}
            onClick={() => void refreshComfyLocations()}
          >
            <RefreshCw
              size={14}
              strokeWidth={2}
              aria-hidden="true"
              className={refreshing ? 'spin' : undefined}
            />
          </button>
        ) : null}
      </div>
      {comfyConfigured && moveFor ? (
        <div className="output-move-bar" onClick={(e) => e.stopPropagation()}>
          <span className="hint">
            Move <span className="mono">{moveFor.fileName}</span> to
          </span>
          <input
            className="mono"
            list="comfy-lora-subfolders"
            placeholder="e.g. Characters/MyLora or !Testing"
            value={moveTarget}
            onChange={(e) => setMoveTarget(e.target.value)}
          />
          <datalist id="comfy-lora-subfolders">
            {subfolders.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
          <button type="button" className="primary" onClick={() => void confirmMove()}>
            Move
          </button>
          <button type="button" onClick={() => setMoveFor(null)}>
            Cancel
          </button>
        </div>
      ) : null}
      {checkpoints.map((cp: CheckpointEntry) =>
        cp.pending ? (
          <div
            key={cp.relativePath}
            className="output-row output-row-pending"
            title="Planned by open job — not written yet"
          >
            {comfyConfigured ? (
              <span className="output-row-keep output-row-keep-placeholder" aria-hidden="true" />
            ) : null}
            <span className="output-row-name mono">{cp.fileName}</span>
            {comfyConfigured ? (
              <span className="output-row-comfy hint">—</span>
            ) : null}
            <span className="output-row-pending-badge">Pending</span>
            <span className="output-row-meta">
              <span className="hint">Further training</span>
            </span>
          </div>
        ) : (
          <div
            key={cp.relativePath}
            role="button"
            tabIndex={0}
            className={`output-row${props.selectedPath === cp.relativePath ? ' active' : ''}${
              cp.keepInComfy ? '' : ' excluded'
            }`}
            title={cp.relativePath}
            onClick={() => props.onSelect(cp)}
            onContextMenu={(e) => openRevealMenu(e, outputAssetRelativePath(cp.relativePath))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                props.onSelect(cp)
              }
            }}
          >
            {comfyConfigured ? (
              <label
                className="output-row-keep"
                title={
                  cp.keepInComfy
                    ? 'Keep a copy under the ComfyUI LoRA folder and include in validation'
                    : 'Excluded — copy removed from LoRA folder / skipped on validation'
                }
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={cp.keepInComfy}
                  onChange={(e) => void toggleKeepInComfy(cp, e.target.checked, e)}
                />
              </label>
            ) : null}
            <span className="output-row-name mono">{cp.fileName}</span>
            {comfyConfigured ? (
              <>
                <span className="output-row-comfy hint mono" title="ComfyUI LoRA subfolder">
                  {cp.comfyRelativeDir ? `${cp.comfyRelativeDir}/` : '—'}
                </span>
                <button
                  type="button"
                  className="output-row-move"
                  title="Move in ComfyUI LoRA folder"
                  onClick={(e) => void openMove(cp, e)}
                >
                  Move
                </button>
              </>
            ) : null}
            <span className="output-row-meta">
              <StarRatingReadout average={cp.averageRating} count={cp.ratingCount} />
              <span>
                {formatBytes(cp.sizeBytes)} · {formatShortDate(cp.mtimeMs)}
              </span>
            </span>
          </div>
        )
      )}
    </div>
  )
}
