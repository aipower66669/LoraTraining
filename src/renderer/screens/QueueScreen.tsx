import { useEffect, useMemo, useRef, useState } from 'react'
import { GripVertical, Pencil, RotateCcw, X } from 'lucide-react'
import {
  QUEUE_LIVE_RATE_SAMPLE_MS,
  QUEUE_SECONDS_PER_STEP,
  buildQueueEtas,
  formatJobStepsLabel,
  resolveJobStepsLabelCurrent,
  formatQueueEtaMs,
  readSecondsPerStep,
  resolveJobTotalSteps
} from '@shared/queue-eta'
import { dropSlotFromPointer, moveIdsToSlot, rangeIdsInclusive } from '@shared/queue-selection'
import { ProgressPanel } from '../components/ProgressPanel'
import { JobBreadcrumb } from '../components/JobBreadcrumb'
import { useConfirm } from '../components/useConfirm'
import {
  DatasetHoverPreviewCard,
  useDatasetHoverPreview
} from '../components/DatasetHoverPreview'
import { unwrap, useAppStore } from '../store'
import { jobBreadcrumbLabel, jobBreadcrumbParts } from '@shared/dataset-jobs'
import { isEditableKeyboardTarget, cycleIndex } from '../util/listKeyboard'
import { useClampedMenuPosition } from '../util/contextMenuPosition'
import { revealJobFolder } from '../util/revealJobFolder'

const LAST_QUEUE_RATE_KEY = 'lora-training:queue-last-seconds-per-step'

function readPersistedQueueRate(): number | null {
  try {
    const v = Number(localStorage.getItem(LAST_QUEUE_RATE_KEY))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null
  }
}

function writePersistedQueueRate(rate: number): void {
  try {
    localStorage.setItem(LAST_QUEUE_RATE_KEY, String(rate))
  } catch {
    /* ignore */
  }
}

export function QueueScreen(): React.JSX.Element {
  const queue = useAppStore((s) => s.queue)
  const jobs = useAppStore((s) => s.jobs)
  const datasets = useAppStore((s) => s.datasets)
  const categories = useAppStore((s) => s.categories)
  const liveProgress = useAppStore((s) => s.liveProgress)
  const logs = useAppStore((s) => s.logs)
  const loadJob = useAppStore((s) => s.loadJob)
  const loadDataset = useAppStore((s) => s.loadDataset)
  const setScreen = useAppStore((s) => s.setScreen)
  const setStatus = useAppStore((s) => s.setStatus)
  const setError = useAppStore((s) => s.setError)
  const clearLogs = useAppStore((s) => s.clearLogs)
  const queueFocusJobId = useAppStore((s) => s.queueFocusJobId)
  const { ask, dialog } = useConfirm()
  const { preview: datasetHoverPreview, bind: bindDatasetHover, clear: clearDatasetHover } =
    useDatasetHoverPreview()

  const categoryNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of categories) map.set(c.id, c.name)
    return map
  }, [categories])

  function partsForJobId(jobId: string): {
    categoryName: string
    datasetName: string
    label: string
  } {
    const job = jobs.find((j) => j.id === jobId)
    if (!job) {
      return { categoryName: 'Uncategorized', datasetName: jobId, label: jobId }
    }
    const ds = datasets.find((d) => d.id === job.datasetId)
    const categoryName = ds ? categoryNameById.get(ds.categoryId) : undefined
    const datasetName = ds?.name ?? job.name
    const parts = jobBreadcrumbParts(categoryName, datasetName)
    return {
      categoryName: parts.category,
      datasetName: parts.dataset,
      label: jobBreadcrumbLabel(categoryName, datasetName)
    }
  }

  function labelForJobId(jobId: string): string {
    return partsForJobId(jobId).label
  }

  const [orderedIds, setOrderedIds] = useState<string[]>([])
  /** Ids currently being dragged (queue order). State for visuals; refs for DnD reliability. */
  const [dragIds, setDragIds] = useState<string[]>([])
  /** Insert-before index in `orderedIds` (`0..length`). */
  const [dropSlot, setDropSlot] = useState<number | null>(null)
  /** Multi-select in queue order; Ctrl toggles, Shift ranges from anchor. */
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null)
  /** Right-click menu for a queue row. */
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; jobId: string } | null>(
    null
  )
  const { menuRef: queueMenuRef, menuStyle: queueMenuStyle } = useClampedMenuPosition(
    contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null
  )
  /** Live s/it while running; retained after stop for offline ETA (also persisted). */
  const [liveRateSecondsPerStep, setLiveRateSecondsPerStep] = useState<number | null>(
    readPersistedQueueRate
  )
  const lastRateSampleAt = useRef(0)
  /** Suppress the click that follows a drag so multi-select isn't collapsed. */
  const suppressClickAfterDrag = useRef(false)
  const dragIdsRef = useRef<string[]>([])
  const dropSlotRef = useRef<number | null>(null)
  const selectedQueueItemRef = useRef<HTMLDivElement | null>(null)
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const dragSet = useMemo(() => new Set(dragIds), [dragIds])
  const isDragging = dragIds.length > 0

  useEffect(() => {
    const ids = queue?.jobIds ?? []
    setOrderedIds(ids)
    dragIdsRef.current = []
    dropSlotRef.current = null
    setDragIds([])
    setDropSlot(null)
    setSelectedIds((prev) => {
      const next = prev.filter((id) => ids.includes(id))
      return next.length === prev.length && next.every((id, i) => id === prev[i]) ? prev : next
    })
    setSelectionAnchorId((anchor) => (anchor && ids.includes(anchor) ? anchor : null))
  }, [queue?.jobIds])

  useEffect(() => {
    if (!queueFocusJobId) return
    const ids = queue?.jobIds ?? []
    if (!ids.includes(queueFocusJobId)) {
      useAppStore.setState({ queueFocusJobId: null })
      return
    }
    setSelectedIds([queueFocusJobId])
    setSelectionAnchorId(queueFocusJobId)
    useAppStore.setState({ queueFocusJobId: null })
  }, [queueFocusJobId, queue?.jobIds])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (contextMenu) {
          setContextMenu(null)
          return
        }
        if (selectedIds.length === 0) return
        setSelectedIds([])
        setSelectionAnchorId(null)
        return
      }

      if (isEditableKeyboardTarget(e.target)) return
      if (contextMenu) return
      if (orderedIds.length === 0) return

      const focusId =
        selectionAnchorId && orderedIds.includes(selectionAnchorId)
          ? selectionAnchorId
          : selectedIds.find((id) => orderedIds.includes(id)) ?? null
      const idx = focusId ? orderedIds.indexOf(focusId) : -1

      if (e.key === 'Home') {
        e.preventDefault()
        const first = orderedIds[0]
        if (!first) return
        setSelectedIds([first])
        setSelectionAnchorId(first)
        return
      }
      if (e.key === 'End') {
        e.preventDefault()
        const last = orderedIds[orderedIds.length - 1]
        if (!last) return
        setSelectedIds([last])
        setSelectionAnchorId(last)
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const nextIdx = cycleIndex(orderedIds.length, idx, e.key === 'ArrowDown' ? 1 : -1)
        const next = orderedIds[nextIdx]
        if (!next) return
        setSelectedIds([next])
        setSelectionAnchorId(next)
        return
      }
      if (e.key === 'Enter') {
        if (!focusId) return
        e.preventDefault()
        void openJob(focusId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedIds, selectionAnchorId, contextMenu, orderedIds])

  useEffect(() => {
    if (selectedIds.length === 0) return
    const frame = window.requestAnimationFrame(() => {
      selectedQueueItemRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [selectionAnchorId, selectedIds])

  useEffect(() => {
    if (!contextMenu) return
    const close = (): void => setContextMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [contextMenu])

  const runningJobId = queue?.runningJobId ?? null

  // Sample toolkit rate while running; keep the last value when training stops.
  useEffect(() => {
    if (!runningJobId) {
      lastRateSampleAt.current = 0
      return
    }
    const maybeSample = (force: boolean): void => {
      const rate = readSecondsPerStep(useAppStore.getState().liveProgress)
      if (rate == null) return
      const now = Date.now()
      if (
        force ||
        lastRateSampleAt.current === 0 ||
        now - lastRateSampleAt.current >= QUEUE_LIVE_RATE_SAMPLE_MS
      ) {
        setLiveRateSecondsPerStep(rate)
        writePersistedQueueRate(rate)
        lastRateSampleAt.current = now
      }
    }
    maybeSample(false)
    const timer = window.setInterval(() => maybeSample(true), QUEUE_LIVE_RATE_SAMPLE_MS)
    return () => window.clearInterval(timer)
  }, [
    runningJobId,
    liveProgress?.secondsPerStep,
    liveProgress?.stepsPerSecond,
    liveProgress?.avgStepMs,
    // Re-sample when phase becomes Training (cache rates must not be stored).
    liveProgress?.lastMessage
  ])

  const running =
    jobs.find((j) => j.id === queue?.runningJobId) ?? jobs.find((j) => j.status === 'running')
  const paused = jobs.find((j) => j.status === 'paused')
  const isRunning = Boolean(running)
  const isPaused = Boolean(paused) && !isRunning
  const progress =
    isRunning || isPaused
      ? (liveProgress ?? running?.progress ?? paused?.progress ?? null)
      : null
  const hasQueued = (queue?.jobIds.length ?? 0) > 0
  const canStart = !isRunning && (hasQueued || isPaused)
  const restartTarget =
    running?.id ??
    paused?.id ??
    queue?.jobIds[0] ??
    jobs.find((j) => j.status === 'failed' || j.status === 'cancelled' || j.status === 'queued')?.id

  const jobsById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs])
  const datasetsById = useMemo(() => new Map(datasets.map((d) => [d.id, d])), [datasets])

  const queueEtas = useMemo(() => {
    if (!queue || orderedIds.length === 0) return []
    // Prefer live job summaries over the queue snapshot cache (stale until list/emit).
    const totalStepsById: Record<string, number> = { ...(queue.totalSteps ?? {}) }
    for (const id of orderedIds) {
      const steps = jobsById.get(id)?.totalSteps
      if (typeof steps === 'number' && steps > 0) totalStepsById[id] = steps
    }
    return buildQueueEtas({
      orderedIds,
      jobsById,
      totalStepsById,
      statuses: queue.statuses,
      liveProgress,
      runningJobId: queue.runningJobId,
      liveRateSecondsPerStep
    })
  }, [queue, orderedIds, jobsById, liveProgress, liveRateSecondsPerStep])

  const queueTotalEta = queueEtas[queueEtas.length - 1]?.finishEtaMs ?? 0

  async function act(
    fn: () => Promise<{ ok: true; value: unknown } | { ok: false; error: { message: string; remediation?: string } }>,
    okMsg: string
  ): Promise<void> {
    try {
      const snap = unwrap(await fn()) as import('@shared/ipc/contract').QueueSnapshot
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

  async function openJob(jobId: string): Promise<void> {
    await loadJob(jobId)
    setScreen('jobs')
  }

  async function openDatasetForJob(jobId: string): Promise<void> {
    const job = jobsById.get(jobId) ?? jobs.find((j) => j.id === jobId)
    if (!job?.datasetId) {
      setError('This job has no linked dataset.')
      return
    }
    await loadDataset(job.datasetId)
    setScreen('datasets')
  }

  async function revealJob(jobId: string): Promise<void> {
    const job = jobsById.get(jobId) ?? jobs.find((j) => j.id === jobId)
    if (!job?.datasetId) {
      setError('This job has no linked dataset.')
      return
    }
    try {
      const where = await revealJobFolder({
        datasetId: job.datasetId,
        hasCheckpoints: (job.checkpointStep ?? 0) > 0
      })
      setStatus(where === 'output' ? 'Opened output folder' : 'Opened dataset folder')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function canDragJob(jobId: string, status: string): boolean {
    return status !== 'running' && jobId !== queue?.runningJobId
  }

  /** Ids to move for Move to Top/Bottom — selection if the target is selected, else just the target. */
  function reorderTargetsFor(jobId: string): string[] {
    const statusOf = (id: string): string =>
      queue?.statuses[id] ?? jobsById.get(id)?.status ?? 'queued'
    if (selectedSet.has(jobId) && selectedIds.length > 1) {
      return orderedIds.filter((id) => selectedSet.has(id) && canDragJob(id, statusOf(id)))
    }
    return canDragJob(jobId, statusOf(jobId)) ? [jobId] : []
  }

  function topInsertSlot(): number {
    // Never insert ahead of a running job at the front.
    if (queue?.runningJobId && orderedIds[0] === queue.runningJobId) return 1
    return 0
  }

  function openQueueContextMenu(e: React.MouseEvent, id: string): void {
    e.preventDefault()
    e.stopPropagation()
    clearDatasetHover()
    if (!selectedSet.has(id)) {
      setSelectedIds([id])
      setSelectionAnchorId(id)
    }
    setContextMenu({ x: e.clientX, y: e.clientY, jobId: id })
  }

  function selectQueueItem(e: React.MouseEvent, id: string): void {
    if (suppressClickAfterDrag.current) {
      suppressClickAfterDrag.current = false
      return
    }
    const target = e.target as HTMLElement
    if (target.closest('button, .queue-item-actions')) return

    const additive = e.ctrlKey || e.metaKey
    const range = e.shiftKey

    if (range && selectionAnchorId) {
      const span = rangeIdsInclusive(orderedIds, selectionAnchorId, id)
      if (additive) {
        const next = new Set(selectedIds)
        for (const x of span) next.add(x)
        setSelectedIds(orderedIds.filter((x) => next.has(x)))
      } else {
        setSelectedIds(span)
      }
      return
    }

    if (additive) {
      const next = new Set(selectedIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      setSelectedIds(orderedIds.filter((x) => next.has(x)))
      setSelectionAnchorId(id)
      return
    }

    setSelectedIds([id])
    setSelectionAnchorId(id)
  }

  function clearDragState(): void {
    dragIdsRef.current = []
    dropSlotRef.current = null
    setDragIds([])
    setDropSlot(null)
  }

  function updateDropSlot(slot: number): void {
    if (dropSlotRef.current === slot) return
    dropSlotRef.current = slot
    setDropSlot(slot)
  }

  async function commitReorder(moving: string[], insertBeforeIndex: number): Promise<void> {
    if (!queue) return
    if (moving.length === 0) {
      clearDragState()
      return
    }
    if (queue.runningJobId && moving.includes(queue.runningJobId)) {
      setError('Stop or pause the running job before reordering it.')
      clearDragState()
      setOrderedIds(queue.jobIds)
      return
    }
    // Don't insert ahead of a running job at the front.
    let slot = insertBeforeIndex
    if (queue.runningJobId && orderedIds[0] === queue.runningJobId && slot === 0) {
      slot = 1
    }
    const next = moveIdsToSlot(orderedIds, moving, slot)
    if (!next) {
      clearDragState()
      return
    }
    setOrderedIds(next)
    clearDragState()
    await act(() => window.loraTraining.queue.reorder(next), 'Queue order updated')
  }

  function onQueueItemDragOver(e: React.DragEvent, idx: number): void {
    if (dragIdsRef.current.length === 0) return
    const id = orderedIds[idx]
    if (!id) return
    const status = queue?.statuses[id] ?? jobsById.get(id)?.status ?? 'queued'
    if (id === queue?.runningJobId || status === 'running') return
    // Must preventDefault or the browser won't fire drop (state can lag behind refs).
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    updateDropSlot(dropSlotFromPointer(idx, e.clientY, rect.top, rect.height))
  }

  return (
    <div className="screen queue-screen">
      {dialog}
      <div className="toolbar">
        {isRunning ? (
          <button
            type="button"
            className="danger"
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
                await act(() => window.loraTraining.queue.stop(), 'Stopped')
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
              void act(
                () => window.loraTraining.queue.start(),
                isPaused ? 'Resumed' : 'Queue started'
              )
            }
          >
            Start
          </button>
        )}

        {isRunning || queue?.stopAfterCurrent ? (
          <button
            type="button"
            className={queue?.stopAfterCurrent ? 'primary' : undefined}
            title={
              queue?.stopAfterCurrent
                ? 'Cancel: queue will continue after this job finishes'
                : 'Let this training finish, then do not start the next queued jobs'
            }
            onClick={() =>
              void act(
                () =>
                  window.loraTraining.queue.stopAfterCurrent(!(queue?.stopAfterCurrent ?? false)),
                queue?.stopAfterCurrent
                  ? 'Will continue queue after this job'
                  : 'Will stop queue after this job finishes'
              )
            }
          >
            {queue?.stopAfterCurrent ? 'Stopping after this…' : 'Stop after this'}
          </button>
        ) : null}

        {isPaused ? (
          <button
            type="button"
            className="primary"
            onClick={() => void act(() => window.loraTraining.queue.resume(), 'Resumed')}
          >
            Resume
          </button>
        ) : (
          <button
            type="button"
            disabled={!isRunning}
            title={isRunning ? 'Pause (keeps checkpoints; Start/Resume continues)' : 'Nothing running'}
            onClick={() => {
              void (async () => {
                const ok = await ask({
                  title: 'Pause training?',
                  message:
                    'Pause stops the process. Resume (or Start) continues from the last checkpoint when the toolkit supports it.',
                  confirmLabel: 'Pause'
                })
                if (!ok) return
                await act(() => window.loraTraining.queue.pause(), 'Paused')
              })()
            }}
          >
            Pause
          </button>
        )}

        <button
          type="button"
          className="danger"
          disabled={!restartTarget}
          title="Delete the training output folder and start this job from step 0"
          onClick={() => {
            void (async () => {
              if (!restartTarget) return
              const ok = await ask({
                title: 'Restart / clear output?',
                message: `Delete the output folder for “${labelForJobId(restartTarget)}” and start over from step 0? Existing checkpoints in that folder will be removed.`,
                confirmLabel: 'Restart',
                danger: true
              })
              if (!ok) return
              clearLogs()
              await act(
                () => window.loraTraining.queue.restartClear(restartTarget),
                'Restarted from clean output'
              )
            })()
          }}
        >
          Restart / Clear
        </button>
      </div>

      <div className="queue-layout">
        <div className="panel queue-list-panel">
          <h2 className="section-title">
            Queue (FIFO)
            {queueTotalEta > 0 ? (
              <span
                className="queue-total-eta"
                title={
                  liveRateSecondsPerStep != null
                    ? `Using last measured ~${liveRateSecondsPerStep.toFixed(2)}s/it (updates while a job runs)`
                    : `No measured rate yet — using ~${QUEUE_SECONDS_PER_STEP}s/step until training reports one`
                }
              >
                {' '}
                · total ~{formatQueueEtaMs(queueTotalEta)}
                {liveRateSecondsPerStep != null
                  ? ` · ~${liveRateSecondsPerStep.toFixed(1)}s/it`
                  : ` · ~${QUEUE_SECONDS_PER_STEP}s/it`}
              </span>
            ) : null}
          </h2>
          {!queue || orderedIds.length === 0 ? (
            <div className="empty">Queue is empty. Enqueue a job from the Jobs screen.</div>
          ) : (
            <div
              className="queue-list"
              onDragOver={(e) => {
                // Allow dropping in list padding / gaps between rows.
                if (dragIdsRef.current.length === 0) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                const list = e.currentTarget as HTMLElement
                const items = list.querySelectorAll<HTMLElement>('.queue-item')
                if (items.length === 0) return
                const y = e.clientY
                for (let i = 0; i < items.length; i++) {
                  const rect = items[i]!.getBoundingClientRect()
                  if (y < rect.top + rect.height / 2) {
                    updateDropSlot(i)
                    return
                  }
                }
                updateDropSlot(items.length)
              }}
              onDrop={(e) => {
                e.preventDefault()
                const moving = dragIdsRef.current
                const slot = dropSlotRef.current
                if (moving.length === 0 || slot == null) {
                  clearDragState()
                  return
                }
                void commitReorder(moving, slot)
              }}
            >
              {orderedIds.map((id, idx) => {
                const job = jobs.find((j) => j.id === id)
                const status = queue.statuses[id] ?? job?.status ?? 'queued'
                const isActiveRun = status === 'running'
                const canDrag = canDragJob(id, status)
                const isSelected = selectedSet.has(id)
                const itemDragging = dragSet.has(id)
                const showLineBefore = isDragging && dropSlot === idx
                const ds = job ? datasetsById.get(job.datasetId) : undefined
                const hover = bindDatasetHover(ds)
                const isKeyboardFocus =
                  selectionAnchorId === id ||
                  (selectedIds.length === 1 && selectedIds[0] === id)

                return (
                  <div key={id} className="queue-item-wrap">
                    {showLineBefore ? <div className="queue-drop-line" aria-hidden /> : null}
                    <div
                      ref={isKeyboardFocus ? selectedQueueItemRef : undefined}
                      className={[
                        'queue-item',
                        isActiveRun ? 'queue-item-running' : '',
                        isSelected ? 'queue-item-selected' : '',
                        itemDragging ? 'queue-item-dragging' : '',
                        canDrag ? 'queue-item-draggable' : ''
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      draggable={canDrag}
                      onClick={(e) => selectQueueItem(e, id)}
                      onContextMenu={(e) => openQueueContextMenu(e, id)}
                      onMouseEnter={hover.onMouseEnter}
                      onMouseMove={hover.onMouseMove}
                      onMouseLeave={hover.onMouseLeave}
                      onMouseDown={(e) => {
                        // Avoid native text selection while multi-selecting.
                        if (e.shiftKey || e.ctrlKey || e.metaKey) e.preventDefault()
                      }}
                      onDragStart={(e) => {
                        if (!canDrag) {
                          e.preventDefault()
                          return
                        }
                        const target = e.target as HTMLElement
                        if (target.closest('button, .queue-item-actions')) {
                          e.preventDefault()
                          return
                        }
                        // Dragging an unselected row selects only that row first.
                        let moving = selectedSet.has(id)
                          ? orderedIds.filter(
                              (x) =>
                                selectedSet.has(x) &&
                                canDragJob(
                                  x,
                                  queue.statuses[x] ?? jobsById.get(x)?.status ?? 'queued'
                                )
                            )
                          : [id]
                        if (!moving.includes(id)) moving = [id]
                        if (!selectedSet.has(id)) {
                          setSelectedIds([id])
                          setSelectionAnchorId(id)
                        }
                        suppressClickAfterDrag.current = true
                        dragIdsRef.current = moving
                        dropSlotRef.current = idx
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', moving.join('\n'))
                        setDragIds(moving)
                        setDropSlot(idx)
                      }}
                      onDragEnd={() => {
                        clearDragState()
                      }}
                      onDragOver={(e) => onQueueItemDragOver(e, idx)}
                      onDrop={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        const moving = dragIdsRef.current
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        const slot = dropSlotFromPointer(idx, e.clientY, rect.top, rect.height)
                        dropSlotRef.current = slot
                        if (moving.length === 0) {
                          clearDragState()
                          return
                        }
                        void commitReorder(moving, slot)
                      }}
                      onDoubleClick={(e) => {
                        const target = e.target as HTMLElement
                        if (target.closest('button, .queue-item-actions')) return
                        void openJob(id)
                      }}
                    >
                    <span className="queue-item-main">
                      {canDrag ? (
                        <span className="queue-item-handle" title="Drag to reorder" aria-hidden>
                          <GripVertical size={14} strokeWidth={2} />
                        </span>
                      ) : (
                        <span className="queue-item-handle queue-item-handle-locked" aria-hidden />
                      )}
                      <span className="queue-item-name">
                        <JobBreadcrumb
                          categoryName={partsForJobId(id).categoryName}
                          datasetName={partsForJobId(id).datasetName}
                        />
                      </span>
                      {status !== 'queued' ? (
                        <span className={`status-pill ${status}`}>{status}</span>
                      ) : null}
                    </span>
                    {(() => {
                      const steps = resolveJobTotalSteps({
                        totalSteps: job?.totalSteps ?? queue.totalSteps?.[id],
                        progressTotalSteps:
                          (id === queue.runningJobId
                            ? liveProgress?.totalSteps
                            : undefined) ?? job?.progress?.totalSteps,
                        status
                      })
                      const rowProgress =
                        id === queue.runningJobId
                          ? (liveProgress ?? job?.progress ?? null)
                          : (job?.progress ?? null)
                      const current = resolveJobStepsLabelCurrent({
                        status,
                        checkpointStep: job?.checkpointStep,
                        progressCurrentStep: rowProgress?.currentStep,
                        liveCurrentStep:
                          id === queue.runningJobId ? liveProgress?.currentStep : undefined,
                        progress: rowProgress
                      })
                      const label = formatJobStepsLabel(current, steps)
                      return (
                        <span
                          className={`queue-item-steps${steps <= 0 ? ' queue-item-steps-empty' : ''}`}
                      title={
                        steps <= 0
                          ? 'Steps unknown'
                          : current > 0
                            ? `Latest checkpoint ${label}`
                            : 'Configured training steps'
                      }
                        >
                          {steps > 0 ? label : '—'}
                        </span>
                      )
                    })()}
                    {(() => {
                      const eta = queueEtas[idx]
                      if (!eta || eta.ownSteps <= 0) {
                        return (
                          <span className="queue-item-times queue-item-times-empty" title="Timing unavailable">
                            <span className="queue-item-duration">—</span>
                            <span className="queue-item-finish">—</span>
                          </span>
                        )
                      }
                      return (
                        <span
                          className="queue-item-times"
                          title={
                            eta.usedLiveRate
                              ? status === 'running' || status === 'paused'
                                ? `${eta.ownSteps.toLocaleString()} steps left · ~${eta.secondsPerStep.toFixed(2)}s/it`
                                : `${eta.ownSteps.toLocaleString()} steps · ~${eta.secondsPerStep.toFixed(2)}s/it (last measured)`
                              : `${eta.ownSteps.toLocaleString()} steps · ~${QUEUE_SECONDS_PER_STEP}s/step (no measured rate yet)`
                          }
                        >
                          <span
                            className="queue-item-duration"
                            title={`This job alone (~${formatQueueEtaMs(eta.ownDurationMs)})`}
                          >
                            ~{formatQueueEtaMs(eta.ownDurationMs)}
                          </span>
                          <span
                            className="queue-item-finish"
                            title={`Finished after jobs ahead (~${formatQueueEtaMs(eta.finishEtaMs)} from now)`}
                          >
                            ~{formatQueueEtaMs(eta.finishEtaMs)}
                          </span>
                        </span>
                      )
                    })()}
                    <span className="toolbar queue-item-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        title={isActiveRun ? 'View job settings (read-only while running)' : 'Edit job settings'}
                        aria-label={isActiveRun ? 'View job settings' : 'Edit job settings'}
                        onClick={() => void openJob(id)}
                      >
                        <Pencil size={14} strokeWidth={2} aria-hidden="true" />
                      </button>
                      {!isActiveRun ? (
                        <>
                          {(status === 'failed' || status === 'cancelled') && (
                            <button
                              type="button"
                              className="icon-btn"
                              title="Retry job"
                              aria-label="Retry job"
                              onClick={() =>
                                void act(() => window.loraTraining.queue.retry(id), 'Retried')
                              }
                            >
                              <RotateCcw size={14} strokeWidth={2} aria-hidden="true" />
                            </button>
                          )}
                          <button
                            type="button"
                            className="icon-btn danger"
                            title="Remove from queue"
                            aria-label="Remove from queue"
                            onClick={() =>
                              void act(() => window.loraTraining.queue.remove(id), 'Removed')
                            }
                          >
                            <X size={14} strokeWidth={2} aria-hidden="true" />
                          </button>
                        </>
                      ) : null}
                    </span>
                  </div>
                  </div>
                )
              })}
              {isDragging && dropSlot === orderedIds.length ? (
                <div className="queue-drop-line" aria-hidden />
              ) : null}
            </div>
          )}
        </div>

        <div className="panel queue-progress-panel">
          <ProgressPanel progress={progress} logs={logs} onClearLogs={() => clearLogs()} />
        </div>
      </div>
      {contextMenu
        ? (() => {
            const id = contextMenu.jobId
            const status = queue?.statuses[id] ?? jobsById.get(id)?.status ?? 'queued'
            const isActiveRun = status === 'running' || id === queue?.runningJobId
            const moving = reorderTargetsFor(id)
            const canReorder = moving.length > 0
            const multi = moving.length > 1
            const editTitle = isActiveRun
              ? 'Open job settings (read-only while this job is running)'
              : 'Open this job on the Jobs screen to edit training settings'
            const moveTopTitle = isActiveRun
              ? 'Cannot move the running job'
              : !canReorder
                ? 'This job cannot be reordered'
                : multi
                  ? `Move ${moving.length} selected jobs to the top of the queue (after any running job)`
                  : 'Move this job to the top of the queue (after any running job)'
            const moveBottomTitle = isActiveRun
              ? 'Cannot move the running job'
              : !canReorder
                ? 'This job cannot be reordered'
                : multi
                  ? `Move ${moving.length} selected jobs to the end of the queue`
                  : 'Move this job to the end of the queue'
            const removeTitle = isActiveRun
              ? 'Stop or pause before removing the running job'
              : 'Take this job out of the queue (job record is kept)'
            return (
              <div
                ref={queueMenuRef}
                className="context-menu"
                style={queueMenuStyle}
                role="menu"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="context-menu-item"
                  title={moveTopTitle}
                  disabled={!canReorder}
                  onClick={() => {
                    setContextMenu(null)
                    if (!canReorder) return
                    void commitReorder(moving, topInsertSlot())
                  }}
                >
                  Move to Top
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="context-menu-item"
                  title={moveBottomTitle}
                  disabled={!canReorder}
                  onClick={() => {
                    setContextMenu(null)
                    if (!canReorder) return
                    void commitReorder(moving, orderedIds.length)
                  }}
                >
                  Move to Bottom
                </button>
                <div className="context-menu-sep" role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  className="context-menu-item"
                  title={editTitle}
                  onClick={() => {
                    setContextMenu(null)
                    void openJob(id)
                  }}
                >
                  Edit Job
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="context-menu-item"
                  title="Open the linked dataset in the Datasets screen"
                  onClick={() => {
                    setContextMenu(null)
                    void openDatasetForJob(id)
                  }}
                >
                  Open Dataset
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="context-menu-item"
                  title={
                    (jobsById.get(id)?.checkpointStep ?? 0) > 0
                      ? 'Open the dataset output folder (checkpoints)'
                      : 'Open the dataset folder on disk'
                  }
                  onClick={() => {
                    setContextMenu(null)
                    void revealJob(id)
                  }}
                >
                  Reveal in Explorer
                </button>
                <div className="context-menu-sep" role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  className="context-menu-item danger"
                  title={removeTitle}
                  disabled={isActiveRun}
                  onClick={() => {
                    setContextMenu(null)
                    if (isActiveRun) return
                    void act(() => window.loraTraining.queue.remove(id), 'Removed')
                  }}
                >
                  Remove from Queue
                </button>
              </div>
            )
          })()
        : null}
      <DatasetHoverPreviewCard preview={datasetHoverPreview} />
    </div>
  )
}
