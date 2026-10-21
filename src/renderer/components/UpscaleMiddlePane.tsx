import { useEffect, useState } from 'react'
import { comfyStepPercent, formatComfyProgressLine } from '@shared/comfy-progress'
import { datasetMediaUrl, datasetOriginalMediaUrl } from '../media-url'
import { useAppStore } from '../store'
import { useRevealInExplorerMenu } from './RevealInExplorerMenu'

/**
 * Upscale/Detail tool's middle pane: before/after comparison, unlike Validation's
 * live-preview-in-details-panel design (explicit request — see plan). Only ever
 * shows a dataset-native image, opened via the grid's "Upscale" context-menu item
 * (the generic external drag-and-drop mode was dropped — see plan).
 */
export function UpscaleMiddlePane(props: { datasetId: string }): React.JSX.Element {
  const rawSource = useAppStore((s) => s.upscaleSource)
  // Guard against a stale source from a previously viewed dataset lingering after switching datasets.
  const source = rawSource && rawSource.datasetId === props.datasetId ? rawSource : null
  const setSource = useAppStore((s) => s.setUpscaleSource)
  const openRequest = useAppStore((s) => s.upscaleOpenRequest)
  const progress = useAppStore((s) => s.upscaleProgress)
  const datasetDetail = useAppStore((s) => s.datasetDetail)
  const [resultBust, setResultBust] = useState(0)
  const { openRevealMenu, revealMenuEl } = useRevealInExplorerMenu(props.datasetId)

  useEffect(() => {
    if (!openRequest) return
    if (openRequest.datasetId !== props.datasetId) return
    setSource({ datasetId: openRequest.datasetId, fileName: openRequest.fileName })
  }, [openRequest, props.datasetId, setSource])

  const progressForThisImage =
    progress && source && progress.datasetId === source.datasetId && progress.fileName === source.fileName
      ? progress
      : null

  useEffect(() => {
    if (progressForThisImage?.status === 'done' || progressForThisImage?.hasOriginal) {
      setResultBust(Date.now())
    }
  }, [
    progressForThisImage?.status,
    progressForThisImage?.hasOriginal,
    progressForThisImage?.fileName,
    progressForThisImage?.lastMessage
  ])

  if (!source) {
    return (
      <div className="middle-panel-body upscale-middle">
        <div className="upscale-empty">
          <p>Right-click an image in this dataset and choose “Upscale” to get started.</p>
        </div>
      </div>
    )
  }

  const img = datasetDetail?.images.find((i) => i.fileName === source.fileName) ?? null
  const hasOriginal = progressForThisImage?.hasOriginal ?? img?.hasOriginal ?? false
  const running = progressForThisImage?.status === 'running'

  const beforeSrc = hasOriginal
    ? datasetOriginalMediaUrl(source.datasetId, source.fileName)
    : datasetMediaUrl(
        source.datasetId,
        source.fileName,
        img ? `${img.mtimeMs}-v${img.versionCount}` : undefined
      )
  const afterSrc = hasOriginal
    ? datasetMediaUrl(
        source.datasetId,
        source.fileName,
        img ? `${img.mtimeMs}-v${img.versionCount}` : resultBust
      )
    : null

  const comfyLiveLine = running
    ? formatComfyProgressLine({
        nodeTitle: progressForThisImage.comfyNodeTitle,
        step: progressForThisImage.comfyStep,
        max: progressForThisImage.comfyMax,
        detail: progressForThisImage.comfyDetail
      }) || null
    : null
  const comfyPct = running
    ? comfyStepPercent(progressForThisImage.comfyStep, progressForThisImage.comfyMax)
    : null

  return (
    <div className="middle-panel-body upscale-middle">
      {revealMenuEl}
      <div className="upscale-compare">
        <div className="upscale-compare-col">
          <div className="upscale-compare-header">
            <span className="section-title">Before</span>
          </div>
          <div
            className="validation-image-wrap"
            onContextMenu={(e) =>
              openRevealMenu(e, hasOriginal ? `${source.fileName}.original` : source.fileName)
            }
          >
            <img className="validation-image" src={beforeSrc} alt={source.fileName} />
          </div>
          <p className="validation-live-preview-label hint" title={source.fileName}>
            {source.fileName}
          </p>
        </div>
        <div className="upscale-compare-col">
          <div className="upscale-compare-header">
            <span className="section-title">After</span>
          </div>
          <div
            className="validation-image-wrap"
            onContextMenu={
              afterSrc ? (e) => openRevealMenu(e, source.fileName) : undefined
            }
          >
            {afterSrc ? (
              <img className="validation-image" src={afterSrc} alt={source.fileName} />
            ) : (
              <div className="empty">{running ? 'Generating…' : 'Not upscaled yet'}</div>
            )}
          </div>
          {afterSrc ? (
            <p className="validation-live-preview-label hint" title={source.fileName}>
              {source.fileName}
            </p>
          ) : running ? (
            <div className="upscale-compare-progress" aria-live="polite">
              <p className="validation-comfy-live-line mono">
                {comfyLiveLine ?? 'Waiting for ComfyUI…'}
              </p>
              {comfyPct != null ? (
                <div
                  className="validation-progress-bar"
                  role="progressbar"
                  aria-valuenow={comfyPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="ComfyUI sampler progress"
                >
                  <div className="validation-progress-bar-fill" style={{ width: `${comfyPct}%` }} />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
