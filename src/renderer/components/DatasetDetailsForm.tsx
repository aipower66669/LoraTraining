import { useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import type { CategorySummary, DatasetDetail } from '@shared/ipc/contract'
import { defaultLoraName } from '@shared/lora-name'
import { CaptionEditor } from './CaptionEditor'
import { useAppStore, unwrap } from '../store'

export interface DatasetMetaPatch {
  name?: string
  trigger?: string
  captionGuidance?: string
  categoryId?: string
  ready?: boolean
}

export interface DatasetDetailsFormProps {
  detail: DatasetDetail
  categoryOptions: CategorySummary[]
  selectedImage: string | null
  selectedImages: string[]
  captionReloadKey: number
  showCaptionGuidance?: boolean
  onSaveMeta: (patch: DatasetMetaPatch) => Promise<void>
  onStatus: (message: string) => void
  onError: (message: string) => void
}

type MetaDraft = {
  name: string
  categoryId: string
  trigger: string
  captionGuidance: string
  ready: boolean
}

function draftFromDetail(detail: DatasetDetail): MetaDraft {
  return {
    name: detail.name,
    categoryId: detail.categoryId,
    trigger: detail.trigger,
    captionGuidance: detail.captionGuidance ?? '',
    ready: detail.ready
  }
}

function suggestedTrigger(
  detail: DatasetDetail,
  categoryOptions: CategorySummary[]
): string {
  const categoryName =
    categoryOptions.find((c) => c.id === detail.categoryId)?.name?.trim() ?? ''
  return defaultLoraName(categoryName, detail.name)
}

/**
 * Dataset metadata form + caption editor.
 * Meta fields use a local draft synced when the dataset id changes (select),
 * then saved on blur — not rebound to background disk reloads.
 */
export function DatasetDetailsForm(props: DatasetDetailsFormProps): React.JSX.Element {
  const {
    detail,
    categoryOptions,
    selectedImage,
    selectedImages,
    captionReloadKey,
    showCaptionGuidance = false,
    onSaveMeta,
    onStatus,
    onError
  } = props
  const [draft, setDraft] = useState<MetaDraft>(() => {
    const base = draftFromDetail(detail)
    if (base.trigger.trim()) return base
    return { ...base, trigger: suggestedTrigger(detail, categoryOptions) }
  })
  const multiSelected = selectedImages.length > 1

  // Resync only when switching datasets — never on every detail refresh.
  // Empty trigger → prefill Category_Dataset (spaces/punctuation → _).
  useEffect(() => {
    const base = draftFromDetail(detail)
    if (base.trigger.trim()) {
      setDraft(base)
      return
    }
    const trigger = suggestedTrigger(detail, categoryOptions)
    setDraft({ ...base, trigger })
    if (trigger && trigger !== detail.trigger) {
      void onSaveMeta({ trigger })
    }
     
  }, [detail.id])

  function patchDraft(next: Partial<MetaDraft>): void {
    setDraft((prev) => ({ ...prev, ...next }))
  }

  async function deleteSelectedImages(permanent: boolean): Promise<void> {
    const targets =
      selectedImages.length > 0
        ? selectedImages
        : selectedImage
          ? [selectedImage]
          : []
    if (targets.length === 0) return

    const loadDataset = useAppStore.getState().loadDataset
    const refreshAll = useAppStore.getState().refreshAll

    try {
      if (targets.length === 1) {
        const deletedName = targets[0]!
        const images = detail.images
        const idx = images.findIndex((img) => img.fileName === deletedName)
        const result = unwrap(
          await window.loraTraining.datasets.deleteImage(detail.id, deletedName, {
            permanent
          })
        ) as {
          deleted: true
          permanent: boolean
          fileName: string
          coverFileName: string | null
          stats: DatasetDetail['stats']
          updatedAt: string
        }
        const nextImages = images.filter((img) => img.fileName !== result.fileName)
        const nextSelected =
          idx < 0
            ? (nextImages[0]?.fileName ?? null)
            : (nextImages[idx]?.fileName ?? nextImages[idx - 1]?.fileName ?? null)
        const datasets = useAppStore.getState().datasets
        useAppStore.setState({
          datasetDetail: {
            ...detail,
            images: nextImages,
            coverFileName: result.coverFileName,
            stats: result.stats,
            updatedAt: result.updatedAt
          },
          selectedImage: nextSelected,
          selectedImages: nextSelected ? [nextSelected] : [],
          datasets: datasets.map((d) =>
            d.id === detail.id
              ? {
                  ...d,
                  stats: result.stats,
                  coverFileName: result.coverFileName,
                  updatedAt: result.updatedAt
                }
              : d
          )
        })
        onStatus(
          result.permanent
            ? `Permanently deleted ${deletedName}`
            : `Moved ${deletedName} to Recycle Bin`
        )
        return
      }

      let deleted = 0
      for (const fileName of targets) {
        unwrap(
          await window.loraTraining.datasets.deleteImage(detail.id, fileName, {
            permanent
          })
        )
        deleted++
      }
      await loadDataset(detail.id)
      await refreshAll()
      onStatus(
        permanent
          ? `Permanently deleted ${deleted} image${deleted === 1 ? '' : 's'}`
          : `Moved ${deleted} image${deleted === 1 ? '' : 's'} to Recycle Bin`
      )
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
      try {
        await loadDataset(detail.id)
        await refreshAll()
      } catch {
        /* ignore follow-up */
      }
    }
  }

  async function revealSelectedImage(): Promise<void> {
    if (!selectedImage) return
    try {
      unwrap(await window.loraTraining.datasets.revealImage(detail.id, selectedImage))
      onStatus(`Revealed ${selectedImage}`)
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="panel details-panel">
      <div className="details-meta">
        <h2 className="section-title">Dataset</h2>
        <div className="form-grid form-rows">
          {selectedImage ? (
            <div className="field-row">
              <span className="field-label">Filename</span>
              <span className="field-row-with-btn">
                <input
                  className="mono"
                  value={
                    multiSelected
                      ? `${selectedImages.length} images selected`
                      : selectedImage
                  }
                  readOnly
                  tabIndex={0}
                  title={
                    multiSelected
                      ? selectedImages.join('\n')
                      : [detail.folderPath.replace(/[/\\]+$/, '').replace(/\//g, '\\'), selectedImage].join(
                          '\\'
                        )
                  }
                />
                {!multiSelected ? (
                  <button
                    type="button"
                    className="icon-btn"
                    title="Reveal in Explorer"
                    aria-label="Reveal in Explorer"
                    onClick={() => void revealSelectedImage()}
                  >
                    <FolderOpen size={14} strokeWidth={2} aria-hidden="true" />
                  </button>
                ) : null}
              </span>
            </div>
          ) : null}
          <label className="field-row">
            <span className="field-label">Name</span>
            <input
              value={draft.name}
              onChange={(e) => patchDraft({ name: e.target.value })}
              onBlur={(e) => void onSaveMeta({ name: e.target.value })}
            />
          </label>
          <label className="field-row">
            <span className="field-label">Category</span>
            <select
              value={draft.categoryId}
              onChange={(e) => {
                const categoryId = e.target.value
                patchDraft({ categoryId })
                void onSaveMeta({ categoryId })
              }}
            >
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field-row">
            <span className="field-label">Trigger</span>
            <input
              className="mono"
              value={draft.trigger}
              onChange={(e) => patchDraft({ trigger: e.target.value })}
              onBlur={(e) => void onSaveMeta({ trigger: e.target.value })}
            />
          </label>
          {showCaptionGuidance ? (
            <label className="field-row field-row-top">
              <span className="field-label">Description</span>
              <textarea
                rows={2}
                value={draft.captionGuidance}
                placeholder="Short context for JoyCaption (subject, domain, what to avoid)…"
                onChange={(e) => patchDraft({ captionGuidance: e.target.value })}
                onBlur={(e) => void onSaveMeta({ captionGuidance: e.target.value })}
              />
            </label>
          ) : null}
          <label className="field-row check">
            <span className="field-label">Ready</span>
            <input
              type="checkbox"
              checked={draft.ready}
              onChange={(e) => {
                const ready = e.target.checked
                patchDraft({ ready })
                void onSaveMeta({ ready })
              }}
            />
          </label>
        </div>
        <div className="details-caption-header">
          <h2 className="section-title details-caption-title">Caption</h2>
          {selectedImage || selectedImages.length > 0 ? (
            <button
              type="button"
              className="danger"
              title={
                multiSelected
                  ? `Move ${selectedImages.length} images to Recycle Bin (Del). Shift+click or Shift+Del deletes permanently.`
                  : 'Move to Recycle Bin (Del). Shift+click or Shift+Del deletes permanently.'
              }
              onClick={(e) => void deleteSelectedImages(e.shiftKey)}
            >
              {multiSelected ? 'Delete Images' : 'Delete image'}
            </button>
          ) : null}
        </div>
      </div>
      <CaptionEditor
        datasetId={detail.id}
        fileNames={selectedImages.length > 0 ? selectedImages : selectedImage ? [selectedImage] : []}
        fill
        reloadKey={captionReloadKey}
      />
    </div>
  )
}
