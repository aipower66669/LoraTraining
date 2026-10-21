import { useEffect, useMemo, useState } from 'react'
import type { CheckpointEntry } from '@shared/ipc/contract'
import { isTypingTarget, wrapIndex } from '@shared/keyboard'
import { validationSetLabel } from '@shared/validation-sets'
import { datasetMediaUrl } from '../media-url'
import { unwrap, useAppStore } from '../store'
import { useRevealInExplorerMenu, outputAssetRelativePath } from './RevealInExplorerMenu'
import { StarRating } from './StarRating'
import { useConfirm } from './useConfirm'

type SetTab = { index: number; label: string }

export function OutputValidationDetails(props: {
  datasetId: string
  checkpoint: CheckpointEntry | null
  onRatingsChanged?: (patch: {
    stem: string
    averageRating: number | null
    ratingCount: number
  }) => void
  onPreviewDeleted?: (info: { stem: string; setLabel: string }) => void
}): React.JSX.Element {
  const setStatus = useAppStore((s) => s.setStatus)
  const setError = useAppStore((s) => s.setError)
  const { ask, dialog } = useConfirm()
  const { openRevealMenu, revealMenuEl } = useRevealInExplorerMenu(props.datasetId)
  const [sets, setSets] = useState<SetTab[]>([{ index: 0, label: 'Set 1' }])
  const [activeIndex, setActiveIndex] = useState(0)
  const [imgFailed, setImgFailed] = useState(false)
  const [rating, setRating] = useState<number | null>(null)
  const [ratingBusy, setRatingBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    void window.loraTraining.comfy.listValidationSets(props.datasetId).then((r) => {
      try {
        const list = unwrap(r) as Array<{ index: number; label: string }>
        if (list.length > 0) {
          setSets(list.map((s) => ({ index: s.index, label: s.label })))
          setActiveIndex((i) => Math.min(i, list.length - 1))
        }
      } catch {
        /* keep default */
      }
    })
  }, [props.datasetId])

  useEffect(() => {
    setImgFailed(false)
  }, [props.checkpoint?.relativePath, activeIndex])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (e.altKey || e.ctrlKey || e.metaKey) return
      if (isTypingTarget(e.target)) return
      if (sets.length <= 1) return
      e.preventDefault()
      const delta = e.key === 'ArrowRight' ? 1 : -1
      setActiveIndex((i) => wrapIndex(i + delta, sets.length))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [sets.length])

  const activeLabel = sets[activeIndex]?.label ?? validationSetLabel(activeIndex)
  const stem = props.checkpoint?.fileName.replace(/\.safetensors$/i, '') ?? ''

  useEffect(() => {
    if (!stem || !props.checkpoint) {
      setRating(null)
      return
    }
    let cancelled = false
    void window.loraTraining.datasets
      .getValidationRating(props.datasetId, activeLabel, stem)
      .then((r) => {
        if (cancelled) return
        try {
          const v = unwrap(r) as { rating: number | null }
          setRating(v.rating)
        } catch {
          setRating(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [props.datasetId, props.checkpoint, activeLabel, stem])

  const imagePath = useMemo(() => {
    if (!props.checkpoint) return null
    const fromList = props.checkpoint.validationImages?.find((img) => img.setLabel === activeLabel)
    if (fromList) return fromList.relativePath
    return `output/${activeLabel}/${stem}.jpg`
  }, [props.checkpoint, activeLabel, stem])

  const hasImage = Boolean(imagePath) && !imgFailed
  const src =
    props.checkpoint && imagePath && hasImage
      ? datasetMediaUrl(props.datasetId, imagePath, `${activeLabel}:${props.checkpoint.fileName}`)
      : null

  async function saveRating(next: number | null): Promise<void> {
    if (!props.checkpoint || !stem) return
    setRatingBusy(true)
    setRating(next)
    try {
      const result = unwrap(
        await window.loraTraining.datasets.setValidationRating(
          props.datasetId,
          activeLabel,
          stem,
          next
        )
      ) as { rating: number | null; average: number | null; count: number }
      setRating(result.rating)
      props.onRatingsChanged?.({
        stem,
        averageRating: result.average,
        ratingCount: result.count
      })
    } catch {
      try {
        const v = unwrap(
          await window.loraTraining.datasets.getValidationRating(
            props.datasetId,
            activeLabel,
            stem
          )
        ) as { rating: number | null }
        setRating(v.rating)
      } catch {
        setRating(null)
      }
    } finally {
      setRatingBusy(false)
    }
  }

  async function deletePreview(): Promise<void> {
    if (!props.checkpoint || !stem || !hasImage) return
    const ok = await ask({
      title: 'Delete preview image?',
      message: `Delete the ${activeLabel} preview for ${props.checkpoint.fileName}? You can regenerate it with Run.`,
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    setDeleting(true)
    try {
      const result = unwrap(
        await window.loraTraining.datasets.deleteValidationPreview(
          props.datasetId,
          activeLabel,
          stem
        )
      ) as { deleted: true; average: number | null; count: number }
      setRating(null)
      setImgFailed(true)
      props.onRatingsChanged?.({
        stem,
        averageRating: result.average,
        ratingCount: result.count
      })
      props.onPreviewDeleted?.({ stem, setLabel: activeLabel })
      setStatus(`Deleted ${activeLabel} preview for ${stem}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeleting(false)
    }
  }

  if (!props.checkpoint) {
    return (
      <div className="panel details-panel">
        <div className="empty">Select a checkpoint to view validation images.</div>
      </div>
    )
  }

  return (
    <div className="panel details-panel validation-details">
      {dialog}
      {revealMenuEl}
      <div className="details-meta" style={{ maxHeight: 'none', flex: '0 0 auto' }}>
        <div className="validation-set-tabs" role="tablist" aria-label="Validation sets">
          {sets.map((s) => (
            <button
              key={s.index}
              type="button"
              role="tab"
              aria-selected={s.index === activeIndex}
              className={`validation-set-tab${s.index === activeIndex ? ' active' : ''}`}
              onClick={() => setActiveIndex(s.index)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <p
          className="hint mono"
          style={{ marginTop: 0, marginBottom: '0.35rem' }}
          onContextMenu={(e) =>
            openRevealMenu(e, outputAssetRelativePath(props.checkpoint!.relativePath))
          }
        >
          {props.checkpoint.fileName}
        </p>
        {hasImage ? (
          <div className="toolbar" style={{ marginBottom: '0.5rem', flexWrap: 'wrap' }}>
            <StarRating
              value={rating}
              disabled={ratingBusy || deleting}
              onChange={(v) => void saveRating(v)}
            />
            <button
              type="button"
              className="danger"
              disabled={deleting}
              onClick={() => void deletePreview()}
            >
              Delete image
            </button>
          </div>
        ) : null}
      </div>
      {src ? (
        <div className="validation-panel">
          <div
            className="validation-image-wrap"
            onContextMenu={(e) => {
              if (imagePath) openRevealMenu(e, imagePath)
            }}
          >
            <img
              className="validation-image"
              src={src}
              alt={`${activeLabel} · ${props.checkpoint.fileName}`}
              onError={() => setImgFailed(true)}
            />
          </div>
        </div>
      ) : (
        <div className="empty">
          <p>No image for {activeLabel}</p>
          <p className="hint">
            Expected{' '}
            <span className="mono">
              output/{activeLabel}/{stem}.jpg
            </span>
          </p>
        </div>
      )}
    </div>
  )
}
