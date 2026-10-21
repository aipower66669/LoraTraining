import { useEffect, useState } from 'react'
import type { DiversifyMode } from '@shared/diversify-config'
import { comfyStepPercent, formatComfyProgressLine } from '@shared/comfy-progress'
import { datasetMediaUrl } from '../media-url'
import { useAppStore } from '../store'
import { writeLastDiversifyMode } from '../store/actions'
import { useRevealInExplorerMenu } from './RevealInExplorerMenu'

/**
 * Diversify middle pane.
 * Context: source + latest generated sibling.
 * Expression: source only — Run switches back to Images (no after preview).
 */
export function DiversifyMiddlePane(props: {
  datasetId: string
  mode: DiversifyMode
}): React.JSX.Element {
  const rawSource = useAppStore((s) => s.diversifySource)
  const source = rawSource && rawSource.datasetId === props.datasetId ? rawSource : null
  const setSource = useAppStore((s) => s.setDiversifySource)
  const openRequest = useAppStore((s) => s.diversifyOpenRequest)
  const progress = useAppStore((s) => s.diversifyProgress)
  const datasetDetail = useAppStore((s) => s.datasetDetail)
  const [resultBust, setResultBust] = useState(0)
  const { openRevealMenu, revealMenuEl } = useRevealInExplorerMenu(props.datasetId)
  const label = props.mode === 'context' ? 'Context' : 'Expression'
  const isExpression = props.mode === 'expression'

  useEffect(() => {
    writeLastDiversifyMode(props.mode)
  }, [props.mode])

  useEffect(() => {
    if (!openRequest) return
    if (openRequest.datasetId !== props.datasetId) return
    if (openRequest.mode !== props.mode) return
    setSource({ datasetId: openRequest.datasetId, fileName: openRequest.fileName })
  }, [openRequest, props.datasetId, props.mode, setSource])

  const progressForRun =
    progress &&
    progress.datasetId === props.datasetId &&
    progress.mode === props.mode &&
    (progress.fileName === source?.fileName || (progress.batchTotal ?? 0) > 1)
      ? progress
      : null

  useEffect(() => {
    if (progressForRun?.status === 'done' || progressForRun?.outputFileName) {
      setResultBust(Date.now())
    }
  }, [
    progressForRun?.status,
    progressForRun?.outputFileName,
    progressForRun?.fileName,
    progressForRun?.lastMessage
  ])

  if (!source) {
    return (
      <div className="middle-panel-body upscale-middle">
        <div className="upscale-empty">
          <p>
            Right-click an image and choose “Diversify Context” or “Diversify Expression”, or use
            the toolbar, to open {label} with a source.
          </p>
        </div>
      </div>
    )
  }

  const img = datasetDetail?.images.find((i) => i.fileName === source.fileName) ?? null
  const sourceSrc = datasetMediaUrl(
    source.datasetId,
    source.fileName,
    img ? `${img.mtimeMs}-v${img.versionCount}` : undefined
  )

  if (isExpression) {
    return (
      <div className="middle-panel-body upscale-middle">
        {revealMenuEl}
        <div className="upscale-compare">
          <div className="upscale-compare-col">
            <div className="upscale-compare-header">
              <span className="section-title">Source</span>
            </div>
            <div
              className="validation-image-wrap"
              onContextMenu={(e) => openRevealMenu(e, source.fileName)}
            >
              <img className="validation-image" src={sourceSrc} alt={source.fileName} />
            </div>
            <p className="validation-live-preview-label hint" title={source.fileName}>
              {source.fileName}
            </p>
            <p className="hint" style={{ marginTop: '0.5rem' }}>
              Run switches back to Images — new siblings appear in the grid as they finish.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const outputName = progressForRun?.outputFileName ?? null
  const outImg = outputName
    ? (datasetDetail?.images.find((i) => i.fileName === outputName) ?? null)
    : null
  const running = progressForRun?.status === 'running'

  const resultSrc = outputName
    ? datasetMediaUrl(source.datasetId, outputName, outImg?.mtimeMs ?? resultBust)
    : null

  const comfyLiveLine = running
    ? formatComfyProgressLine({
        nodeTitle: progressForRun.comfyNodeTitle,
        step: progressForRun.comfyStep,
        max: progressForRun.comfyMax,
        detail: progressForRun.comfyDetail
      }) || null
    : null
  const comfyPct = running
    ? comfyStepPercent(progressForRun.comfyStep, progressForRun.comfyMax)
    : null

  return (
    <div className="middle-panel-body upscale-middle">
      {revealMenuEl}
      <div className="upscale-compare">
        <div className="upscale-compare-col">
          <div className="upscale-compare-header">
            <span className="section-title">Source</span>
          </div>
          <div
            className="validation-image-wrap"
            onContextMenu={(e) => openRevealMenu(e, source.fileName)}
          >
            <img className="validation-image" src={sourceSrc} alt={source.fileName} />
          </div>
          <p className="validation-live-preview-label hint" title={source.fileName}>
            {source.fileName}
          </p>
        </div>
        <div className="upscale-compare-col">
          <div className="upscale-compare-header">
            <span className="section-title">Generated</span>
          </div>
          <div
            className="validation-image-wrap"
            onContextMenu={
              resultSrc && outputName ? (e) => openRevealMenu(e, outputName) : undefined
            }
          >
            {resultSrc ? (
              <img className="validation-image" src={resultSrc} alt={outputName ?? ''} />
            ) : (
              <div className="empty">{running ? 'Generating…' : 'No output yet'}</div>
            )}
          </div>
          {resultSrc && outputName ? (
            <p className="validation-live-preview-label hint" title={outputName}>
              {outputName}
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
