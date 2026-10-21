import { useEffect, useState } from 'react'
import { Tag } from 'lucide-react'
import type { BulkOp, BulkTransformResult } from '@shared/ipc/contract'
import { BulkCaptionDiff } from './BulkCaptionDiff'
import { ConfirmDialog } from './ConfirmDialog'
import { bulkActionLabel, type BulkOpId } from './bulkActions'
import { useAppStore, unwrap } from '../store'

export interface BulkToolsDialogProps {
  open: boolean
  op: BulkOpId
  datasetId: string | null
  onClose: () => void
  /** Bump the caption editor's reload key after a caption-affecting op is applied. */
  onCaptionsChanged: () => void
}

/** Dialog for the caption bulk-edit / convert-to-jpg / shrink-to-max toolbar actions. */
export function BulkToolsDialog(props: BulkToolsDialogProps): React.JSX.Element {
  const { open, op: bulkOp, datasetId: selectedId, onClose, onCaptionsChanged } = props
  const loadDataset = useAppStore((s) => s.loadDataset)
  const refreshAll = useAppStore((s) => s.refreshAll)
  const setStatus = useAppStore((s) => s.setStatus)
  const setError = useAppStore((s) => s.setError)
  const datasetDetail = useAppStore((s) => s.datasetDetail)
  const trigger =
    datasetDetail && selectedId && datasetDetail.id === selectedId
      ? datasetDetail.trigger.trim()
      : ''

  const [bulkValue, setBulkValue] = useState('')
  const [bulkFind, setBulkFind] = useState('')
  const [bulkMode, setBulkMode] = useState<'prepend' | 'append'>('prepend')
  const [preview, setPreview] = useState<BulkTransformResult | null>(null)
  const [bulkPreviewing, setBulkPreviewing] = useState(false)

  // Opening a (possibly different) bulk action always starts from a fresh preview;
  // typed field values (bulkValue/bulkFind/bulkMode) intentionally persist across opens.
  useEffect(() => {
    if (!open) return
    setPreview(null)
    setBulkPreviewing(true)
  }, [open, bulkOp])

  function buildOp(): BulkOp {
    switch (bulkOp) {
      case 'prefix':
        return { op: 'prefix', value: bulkValue, createMissing: true }
      case 'suffix':
        return { op: 'suffix', value: bulkValue, createMissing: true }
      case 'replace':
        return { op: 'replace', find: bulkFind, replace: bulkValue }
      case 'remove':
        return { op: 'remove', value: bulkValue }
      case 'ensureTrigger':
        return { op: 'ensureTrigger', mode: bulkMode }
      case 'stripTrigger':
        return { op: 'stripTrigger' }
      case 'convertToJpg':
        throw new Error('convertToJpg is not a caption op')
      case 'shrinkToMax':
        throw new Error('shrinkToMax is not a caption op')
    }
  }

  async function computeBulkPreview(op: BulkOpId): Promise<BulkTransformResult> {
    if (!selectedId) {
      return { changed: 0, skipped: 0, dryRun: true, samples: [] }
    }
    if (op === 'convertToJpg') {
      return unwrap(
        await window.loraTraining.datasets.convertImagesToJpg(selectedId, true)
      ) as BulkTransformResult
    }
    if (op === 'shrinkToMax') {
      return unwrap(
        await window.loraTraining.datasets.shrinkImagesToMax(selectedId, true)
      ) as BulkTransformResult
    }
    return unwrap(
      await window.loraTraining.captions.bulkTransform({
        datasetId: selectedId,
        op: (() => {
          switch (op) {
            case 'prefix':
              return { op: 'prefix' as const, value: bulkValue, createMissing: true }
            case 'suffix':
              return { op: 'suffix' as const, value: bulkValue, createMissing: true }
            case 'replace':
              return { op: 'replace' as const, find: bulkFind, replace: bulkValue }
            case 'remove':
              return { op: 'remove' as const, value: bulkValue }
            case 'ensureTrigger':
              return { op: 'ensureTrigger' as const, mode: bulkMode }
            case 'stripTrigger':
              return { op: 'stripTrigger' as const }
            default:
              throw new Error('not a caption op')
          }
        })(),
        dryRun: true
      })
    ) as BulkTransformResult
  }

  useEffect(() => {
    if (!open || !selectedId) return
    let cancelled = false
    setBulkPreviewing(true)
    const needsTyping =
      bulkOp === 'prefix' || bulkOp === 'suffix' || bulkOp === 'replace' || bulkOp === 'remove'
    const timer = setTimeout(
      () => {
        void computeBulkPreview(bulkOp)
          .then((result) => {
            if (!cancelled) setPreview(result)
          })
          .catch((err) => {
            if (!cancelled) setError(err instanceof Error ? err.message : String(err))
          })
          .finally(() => {
            if (!cancelled) setBulkPreviewing(false)
          })
      },
      needsTyping ? 280 : 0
    )
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // Field values are read inside computeBulkPreview from this render.
     
  }, [open, bulkOp, bulkValue, bulkFind, bulkMode, selectedId])

  async function applyBulk(): Promise<void> {
    if (!selectedId) return
    try {
      if (bulkOp === 'convertToJpg' || bulkOp === 'shrinkToMax') {
        const prevSelected = useAppStore.getState().selectedImage
        // Drop in-app image refs so Windows is less likely to EBUSY the source file.
        useAppStore.setState({ selectedImage: null, selectedImages: [] })
        onClose()
        setPreview(null)
        setStatus(bulkOp === 'convertToJpg' ? 'Converting…' : 'Checking…')
        await new Promise((r) => setTimeout(r, 50))
        const result =
          bulkOp === 'convertToJpg'
            ? (unwrap(
                await window.loraTraining.datasets.convertImagesToJpg(selectedId, false)
              ) as BulkTransformResult)
            : (unwrap(
                await window.loraTraining.datasets.shrinkImagesToMax(selectedId, false)
              ) as BulkTransformResult)
        // Final status usually already set by tool-run-updated; keep a clear summary.
        setStatus(
          bulkOp === 'convertToJpg'
            ? `Converted ${result.changed} · ${result.skipped} skipped`
            : result.changed > 0
              ? `Shrunk ${result.changed}/${result.changed} (100%) · ${result.skipped} skipped`
              : `No images needed shrinking · ${result.skipped} skipped`
        )
        await loadDataset(selectedId)
        await refreshAll()
        if (prevSelected) {
          const detailNow = useAppStore.getState().datasetDetail
          const stillThere = detailNow?.images.some((i) => i.fileName === prevSelected)
          if (stillThere) {
            useAppStore.setState({
              selectedImage: prevSelected,
              selectedImages: [prevSelected]
            })
          } else {
            const stem = prevSelected.replace(/\.[^.]+$/, '')
            const next =
              detailNow?.images.find((i) => i.stem === stem)?.fileName ??
              detailNow?.images[0]?.fileName ??
              null
            useAppStore.setState({
              selectedImage: next,
              selectedImages: next ? [next] : []
            })
          }
        }
        return
      }
      // Dismiss immediately (same as convert/shrink above) instead of waiting for
      // the transform to finish: leaving the modal open let an impatient second
      // click on Apply fire the whole bulk transform a second time.
      const op = buildOp()
      const datasetId = selectedId
      onClose()
      setPreview(null)
      setStatus('Updating captions…')
      const result = unwrap(
        await window.loraTraining.captions.bulkTransform({
          datasetId,
          op,
          dryRun: false
        })
      ) as BulkTransformResult
      setStatus(`Updated ${result.changed} captions`)
      await loadDataset(datasetId)
      onCaptionsChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <ConfirmDialog
      open={open}
      title={bulkActionLabel(bulkOp)}
      confirmLabel={preview && !bulkPreviewing && preview.changed === 0 ? 'OK' : 'Apply'}
      hideCancel={Boolean(preview && !bulkPreviewing && preview.changed === 0)}
      // Search/replace: Esc/Cancel/Apply only — not backdrop (easy to mis-click).
      preventBackdropDismiss={bulkOp === 'replace'}
      enterConfirms
      dismissOnAnywhere={
        bulkOp !== 'replace' && Boolean(preview && !bulkPreviewing && preview.changed === 0)
      }
      onCancel={() => {
        onClose()
        setPreview(null)
      }}
      onConfirm={() => void applyBulk()}
    >
      <div className="form-grid">
        {bulkOp === 'convertToJpg' && (
          <p className="hint" style={{ margin: 0 }}>
            Converts .webp, .bmp, and other non-PNG/JPG images to .jpg (quality 92). PNG and
            JPG/JPEG are left alone. Same-stem .txt captions are kept. Skips if a .jpg with that
            name already exists.
          </p>
        )}
        {bulkOp === 'shrinkToMax' && (
          <p className="hint" style={{ margin: 0 }}>
            Downscales images so the shortest side is exactly 1024px (aspect ratio kept; the longer
            side stays ≥ 1024). Images already ≤ 1024 on the short side are skipped — never
            enlarged. Uses Lanczos3 resize and high-quality re-encode in the same format. Captions
            unchanged.
          </p>
        )}
        {(bulkOp === 'prefix' || bulkOp === 'suffix' || bulkOp === 'remove') && (
          <label>
            Value
            <input value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} autoFocus />
            {(bulkOp === 'prefix' || bulkOp === 'suffix') && (
              <span className="hint">
                {bulkOp === 'prefix'
                  ? 'Adds ", " after the prefix if you did not include it.'
                  : 'Adds ", " before the suffix if you did not include it.'}
              </span>
            )}
          </label>
        )}
        {bulkOp === 'replace' && (
          <>
            <label>
              Find
              <span className="bulk-field-with-btn">
                <input value={bulkFind} onChange={(e) => setBulkFind(e.target.value)} autoFocus />
                <button
                  type="button"
                  className="icon-btn"
                  disabled={!trigger}
                  title={
                    trigger
                      ? `Fill with trigger (“${trigger}”)`
                      : 'Set a dataset trigger first'
                  }
                  aria-label={
                    trigger ? `Fill Find with trigger ${trigger}` : 'Fill Find with trigger'
                  }
                  onClick={() => setBulkFind(trigger)}
                >
                  <Tag size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              </span>
            </label>
            <label>
              Replace
              <span className="bulk-field-with-btn">
                <input value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} />
                <button
                  type="button"
                  className="icon-btn"
                  disabled={!trigger}
                  title={
                    trigger
                      ? `Fill with trigger (“${trigger}”)`
                      : 'Set a dataset trigger first'
                  }
                  aria-label={
                    trigger
                      ? `Fill Replace with trigger ${trigger}`
                      : 'Fill Replace with trigger'
                  }
                  onClick={() => setBulkValue(trigger)}
                >
                  <Tag size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              </span>
            </label>
          </>
        )}
        {bulkOp === 'ensureTrigger' && (
          <>
            <p className="hint" style={{ margin: 0 }}>
              Prepend mode adds “trigger, ” only where the dataset trigger is missing (same as Fix
              missing on Create Job).
            </p>
            <label>
              Mode
              <select
                value={bulkMode}
                onChange={(e) => setBulkMode(e.target.value as 'prepend' | 'append')}
              >
                <option value="prepend">Prepend</option>
                <option value="append">Append</option>
              </select>
            </label>
          </>
        )}
        {bulkOp === 'stripTrigger' && (
          <p className="hint" style={{ margin: 0 }}>
            Removes the dataset trigger word from the start or middle of captions when present.
          </p>
        )}
        {bulkPreviewing && !preview ? (
          <p className="hint" style={{ margin: 0 }}>
            Running dry-run preview…
          </p>
        ) : null}
        {preview && (
          <div className="bulk-preview">
            <p className="hint" style={{ margin: 0 }}>
              {bulkPreviewing ? 'Updating preview… · ' : 'Dry-run · '}
              {preview.changed} would change, {preview.skipped} skipped. Undo is not available —
              keep backups.
            </p>
            {preview.samples.map((s) => (
              <div key={s.fileName} className="bulk-preview-sample">
                <div className="mono bulk-preview-file">{s.fileName}</div>
                {bulkOp === 'convertToJpg' || bulkOp === 'shrinkToMax' ? (
                  <div className="hint mono">
                    {s.before} → {s.after}
                  </div>
                ) : (
                  <BulkCaptionDiff before={s.before} after={s.after} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </ConfirmDialog>
  )
}
