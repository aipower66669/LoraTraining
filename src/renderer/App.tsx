import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import type { QueueSnapshot, ScreenId } from '@shared/ipc/contract'
import { unwrap, useAppStore } from './store'
import { DatasetsScreen } from './screens/DatasetsScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { JobsScreen } from './screens/JobsScreen'
import { QueueScreen } from './screens/QueueScreen'
import { progressPercent, TrainingMetrics } from './components/TrainingMetrics'
import { ErrorBoundary } from './components/ErrorBoundary'
import { JobBreadcrumb } from './components/JobBreadcrumb'
import { CaptionQueuePopover } from './components/CaptionQueuePopover'
import { useConfirm } from './components/useConfirm'
import { datasetHasQueuedJob, jobBreadcrumbParts } from '@shared/dataset-jobs'
import { matchesStatusFilter } from '@shared/explorer-status'
import { formatLibraryLoadStatus } from '@shared/library-load-progress'
import { toolConfigFlags } from '@shared/tool-config'

const ImageEditor = lazy(async () => {
  const m = await import('./components/ImageEditor')
  return { default: m.ImageEditor }
})

const NAV: { id: ScreenId; label: string }[] = [
  { id: 'datasets', label: 'Datasets' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'queue', label: 'Queue' }
]

export default function App(): React.JSX.Element {
  const screen = useAppStore((s) => s.screen)
  const setScreen = useAppStore((s) => s.setScreen)
  const setImageScraperOpen = useAppStore((s) => s.setImageScraperOpen)
  const imageScraperOpen = useAppStore((s) => s.imageScraperOpen)
  const statusMessage = useAppStore((s) => s.statusMessage)
  const libraryLoadProgress = useAppStore((s) => s.libraryLoadProgress)
  const error = useAppStore((s) => s.error)
  const setError = useAppStore((s) => s.setError)
  const refreshAll = useAppStore((s) => s.refreshAll)
  const applyEvent = useAppStore((s) => s.applyEvent)
  const queue = useAppStore((s) => s.queue)
  const jobs = useAppStore((s) => s.jobs)
  const datasets = useAppStore((s) => s.datasets)
  const categories = useAppStore((s) => s.categories)
  const settings = useAppStore((s) => s.settings)
  const liveProgress = useAppStore((s) => s.liveProgress)
  const captionProgress = useAppStore((s) => s.captionProgress)
  const validationProgress = useAppStore((s) => s.validationProgress)
  const weightProgress = useAppStore((s) => s.weightProgress)
  const stressProgress = useAppStore((s) => s.stressProgress)
  const previewContinuumActive = useAppStore((s) => s.previewContinuumActive)
  const goToActivePreviewRun = useAppStore((s) => s.goToActivePreviewRun)
  const imageEditorOpen = useAppStore((s) => s.imageEditor !== null)

  useEffect(() => {
    void refreshAll()
    return window.loraTraining.events.subscribe((event) => applyEvent(event))
  }, [refreshAll, applyEvent])

  const running =
    jobs.find((j) => j.id === queue?.runningJobId) ?? jobs.find((j) => j.status === 'running')
  const paused = jobs.find((j) => j.status === 'paused')
  const isRunning = Boolean(running)
  const isPaused = Boolean(paused) && !isRunning
  const trainingActive = isRunning || isPaused
  const toolFlags = useMemo(() => toolConfigFlags(settings), [settings])
  // Keep Stop reachable if configuration is removed while a process is still alive.
  const queueUiAvailable = toolFlags.aiToolkit || isRunning
  const visibleScreen =
    (screen === 'jobs' && !toolFlags.aiToolkit) ||
    (screen === 'queue' && !queueUiAvailable)
      ? 'datasets'
      : screen

  useEffect(() => {
    if (visibleScreen !== screen) setScreen(visibleScreen)
  }, [screen, setScreen, visibleScreen])

  const activeJob = running ?? paused ?? jobs.find((j) => j.status === 'queued')
  const activeJobParts = (() => {
    if (!activeJob) return null
    const ds = datasets.find((d) => d.id === activeJob.datasetId)
    const cat = ds ? categories.find((c) => c.id === ds.categoryId)?.name : undefined
    return jobBreadcrumbParts(cat, ds?.name ?? activeJob.name)
  })()
  const trainingProgress = trainingActive
    ? (liveProgress ?? running?.progress ?? paused?.progress ?? null)
    : null
  const trainingPct = progressPercent(trainingProgress)

  const captionRunning = captionProgress?.status === 'running'
  const captionPct =
    captionProgress && captionProgress.total > 0
      ? Math.min(100, Math.round((captionProgress.completed / captionProgress.total) * 100))
      : 0
  const captionCurrentPath = (() => {
    if (!captionRunning || !captionProgress?.currentFileName) return null
    const ds = datasets.find((d) => d.id === captionProgress.datasetId)
    const file = captionProgress.currentFileName
    if (!ds?.folderPath) return file
    const base = ds.folderPath.replace(/[/\\]+$/, '')
    const sep = ds.folderPath.includes('\\') ? '\\' : '/'
    return `${base}${sep}${file}`
  })()

  const [captionQueueOpen, setCaptionQueueOpen] = useState(false)
  const captionBarRef = useRef<HTMLDivElement | null>(null)
  const { ask, dialog: confirmDialog } = useConfirm()
  const setStatus = useAppStore((s) => s.setStatus)

  useEffect(() => {
    if (!captionRunning) setCaptionQueueOpen(false)
  }, [captionRunning])

  const explorerStatusFilter = useAppStore((s) => s.explorerStatusFilter)
  const setExplorerStatusFilter = useAppStore((s) => s.setExplorerStatusFilter)

  useEffect(() => {
    if (!toolFlags.aiToolkit && explorerStatusFilter === 'queued') {
      setExplorerStatusFilter('all')
    }
  }, [explorerStatusFilter, setExplorerStatusFilter, toolFlags.aiToolkit])

  const datasetsNavCount = useMemo(() => {
    return datasets.filter((ds) =>
      matchesStatusFilter(
        ds,
        explorerStatusFilter,
        toolFlags.aiToolkit && datasetHasQueuedJob(jobs, ds.id)
      )
    ).length
  }, [datasets, jobs, explorerStatusFilter, toolFlags.aiToolkit])
  const queuedCount = queue?.jobIds.length ?? 0
  const hasQueued = queuedCount > 0
  const canStart = !isRunning && (hasQueued || isPaused)
  const showQueueDrawer =
    queueUiAvailable && visibleScreen !== 'queue' && (queuedCount > 0 || trainingActive)

  async function queueAct(
    fn: () => Promise<{ ok: true; value: unknown } | { ok: false; error: { message: string } }>,
    okMsg: string
  ): Promise<void> {
    try {
      const snap = unwrap(await fn()) as QueueSnapshot
      useAppStore.setState((s) => ({
        queue: snap,
        jobs: s.jobs.map((j) => {
          const next = snap.statuses[j.id]
          return next && next !== j.status ? { ...j, status: next } : j
        })
      }))
      setStatus(okMsg)
      void useAppStore.getState().refreshJobs()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  const validating = validationProgress?.status === 'running'
  const weighting = weightProgress?.status === 'running'
  const stressing = stressProgress?.status === 'running'
  const previewRunning = validating || weighting || stressing || previewContinuumActive
  const previewLabel = validating
    ? validationProgress?.setLabel
      ? `Validating · ${validationProgress.setLabel}`
      : 'Validating'
    : weighting
      ? weightProgress?.setLabel
        ? `Validating · ${weightProgress.setLabel}`
        : 'Validating'
      : stressing
        ? stressProgress?.setLabel
          ? `Validating · ${stressProgress.setLabel}`
          : 'Validating'
        : 'Validating…'

  return (
    <div className="app-shell">
      {confirmDialog}
      <header className="app-header">
        <nav className="nav" aria-label="Main">
          {NAV.filter(
            (item) =>
              item.id === 'datasets' ||
              (item.id === 'jobs' && toolFlags.aiToolkit) ||
              (item.id === 'queue' && queueUiAvailable)
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              className={visibleScreen === item.id ? 'active' : ''}
              onClick={() => setScreen(item.id)}
            >
              {item.label}
              {item.id === 'datasets' && datasetsNavCount > 0
                ? ` (${datasetsNavCount})`
                : ''}
              {item.id === 'queue' && queuedCount > 0 ? ` (${queuedCount})` : ''}
            </button>
          ))}
          {previewRunning && toolFlags.comfy ? (
            <button
              type="button"
              className="nav-validating"
              title="Jump to the dataset and set currently running (Validation Steps, Weight, or Stress)"
              onClick={() => void goToActivePreviewRun()}
            >
              {previewLabel}
            </button>
          ) : null}
          <button
            type="button"
            className={visibleScreen === 'datasets' && imageScraperOpen ? 'active' : ''}
            title="Image scraper (Pinterest / Google Images) — click images to download into the selected dataset"
            onClick={() => {
              setScreen('datasets')
              setImageScraperOpen(true)
            }}
          >
            Image Scraper
          </button>
          <button
            type="button"
            className={visibleScreen === 'settings' ? 'active' : ''}
            onClick={() => {
              setImageScraperOpen(false)
              setScreen('settings')
            }}
          >
            Settings
          </button>
        </nav>
      </header>

      <main className="app-main">
        {error && (
          <div className="error-banner" style={{ margin: '0.75rem 1rem 0' }}>
            {error}{' '}
            <button type="button" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}
        {/* Keyed by screen so switching screens after a crash always remounts a clean tree. */}
        <ErrorBoundary
          key={visibleScreen}
          label={NAV.find((n) => n.id === visibleScreen)?.label}
        >
          {visibleScreen === 'datasets' && <DatasetsScreen />}
          {visibleScreen === 'jobs' && toolFlags.aiToolkit && <JobsScreen />}
          {visibleScreen === 'queue' && queueUiAvailable && <QueueScreen />}
          {visibleScreen === 'settings' && <SettingsScreen />}
        </ErrorBoundary>
      </main>

      {showQueueDrawer && (
        <div className={`queue-drawer${trainingActive ? ' queue-drawer-active' : ''}`}>
          <div className="queue-drawer-row">
            <span className="queue-drawer-summary">
              QUEUE
              {' | '}
              {queuedCount > 0 ? `${queuedCount} job(s)` : 'No queued jobs'}
              {activeJobParts
                ? (
                    <>
                      {' | '}
                      <JobBreadcrumb
                        categoryName={activeJobParts.category}
                        datasetName={activeJobParts.dataset}
                      />
                      {` (${isPaused ? 'paused' : activeJob?.status})`}
                    </>
                  )
                : ''}
            </span>
            <div className="queue-drawer-actions">
              {isRunning ? (
                <button
                  type="button"
                  className="danger"
                  title="Stop training (cancels the running job)"
                  onClick={() => {
                    void (async () => {
                      const ok = await ask({
                        title: 'Stop training?',
                        message:
                          'Stop kills the process and marks the job Cancelled. It stays in the queue so you can Retry or Remove it. The next job will not auto-start. Checkpoints already saved are kept.',
                        confirmLabel: 'Stop',
                        danger: true
                      })
                      if (!ok) return
                      await queueAct(() => window.loraTraining.queue.stop(), 'Stopped')
                    })()
                  }}
                >
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  className="primary"
                  disabled={!canStart}
                  title={
                    isPaused
                      ? 'Continue from last checkpoint'
                      : hasQueued
                        ? 'Start the queue'
                        : 'Enqueue a job first'
                  }
                  onClick={() =>
                    void queueAct(
                      () => window.loraTraining.queue.start(),
                      isPaused ? 'Resumed' : 'Queue started'
                    )
                  }
                >
                  Start
                </button>
              )}
              {isPaused ? (
                <button
                  type="button"
                  className="primary"
                  title="Resume paused training"
                  onClick={() =>
                    void queueAct(() => window.loraTraining.queue.resume(), 'Resumed')
                  }
                >
                  Resume
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!isRunning}
                  title={
                    isRunning
                      ? 'Pause (keeps checkpoints; Start/Resume continues)'
                      : 'Nothing running'
                  }
                  onClick={() => {
                    void (async () => {
                      const ok = await ask({
                        title: 'Pause training?',
                        message:
                          'Pause stops the process. Resume (or Start) continues from the last checkpoint when the toolkit supports it.',
                        confirmLabel: 'Pause'
                      })
                      if (!ok) return
                      await queueAct(() => window.loraTraining.queue.pause(), 'Paused')
                    })()
                  }}
                >
                  Pause
                </button>
              )}
              <button type="button" onClick={() => setScreen('queue')}>
                Open
              </button>
            </div>
          </div>
          {trainingActive ? (
            <div className="queue-drawer-progress">
              <div className="progress-bar" aria-label="Training progress">
                <span style={{ width: `${Math.min(100, trainingPct)}%` }} />
              </div>
              <TrainingMetrics progress={trainingProgress} compact />
            </div>
          ) : null}
        </div>
      )}

      <footer className="status-bar">
        <div className="status-bar-left">
          {libraryLoadProgress &&
          libraryLoadProgress.phase !== 'done' &&
          libraryLoadProgress.total > 0 ? (
            <>
              <span>{formatLibraryLoadStatus(libraryLoadProgress)}</span>
              <div
                className="status-caption-wrap"
                title={formatLibraryLoadStatus(libraryLoadProgress)}
                style={{ minWidth: 120, maxWidth: 220 }}
              >
                <div
                  className="status-caption-bar"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.min(
                    100,
                    Math.round((100 * libraryLoadProgress.done) / libraryLoadProgress.total)
                  )}
                  aria-label="Library load progress"
                >
                  <span
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round((100 * libraryLoadProgress.done) / libraryLoadProgress.total)
                      )}%`
                    }}
                  />
                </div>
              </div>
            </>
          ) : (
            <span>{statusMessage}</span>
          )}
          {captionRunning && captionProgress && captionProgress.total > 0 ? (
            <div className="status-caption-wrap">
              <div
                ref={captionBarRef}
                className="status-caption-bar status-caption-bar-clickable"
                role="progressbar"
                tabIndex={0}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={captionPct}
                aria-label="Captioning progress — click to show queue"
                title="Show caption queue"
                onClick={() => setCaptionQueueOpen((o) => !o)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setCaptionQueueOpen((o) => !o)
                  }
                }}
              >
                <span style={{ width: `${captionPct}%` }} />
              </div>
              {captionQueueOpen ? (
                <CaptionQueuePopover
                  open={captionQueueOpen}
                  progress={captionProgress}
                  anchorRef={captionBarRef}
                  onClose={() => setCaptionQueueOpen(false)}
                />
              ) : null}
              <button
                type="button"
                className="status-caption-stop"
                title="Stop captioning and clear the queue"
                aria-label="Stop captioning"
                onClick={() => {
                  void (async () => {
                    try {
                      if (!captionProgress.runId) return
                      unwrap(await window.loraTraining.tools.cancelToolRun(captionProgress.runId))
                      useAppStore.getState().setStatus('Stopping captioning…')
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err))
                    }
                  })()
                }}
              >
                Stop
              </button>
              {captionCurrentPath ? (
                <>
                  <span className="status-caption-sep" aria-hidden="true">
                    |
                  </span>
                  <span className="status-caption-file mono" title={captionCurrentPath}>
                    {captionCurrentPath}
                  </span>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </footer>
      {imageEditorOpen ? (
        <Suspense fallback={null}>
          <ImageEditor />
        </Suspense>
      ) : null}
    </div>
  )
}
