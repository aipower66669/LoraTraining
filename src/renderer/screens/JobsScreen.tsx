import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import type { JobDetail, JobSummary, QueueSnapshot } from '@shared/ipc/contract'
import {
  datasetOutputFolder,
  type TrainingConfig
} from '@shared/schemas/training-config'
import { suggestLoraName } from '@shared/lora-name'
import {
  datasetHasOpenJob,
  isQueuedJobStatus,
  jobBreadcrumbLabel,
  jobBreadcrumbParts,
  openJobForDataset
} from '@shared/dataset-jobs'
import {
  resolveJobTotalSteps,
  resolveJobStepsLabelCurrent,
  formatJobStepsLabel
} from '@shared/queue-eta'
import { rangeIdsInclusive } from '@shared/queue-selection'
import { applySharedTrainingConfigChange } from '@shared/job-multi-edit'
import { hasOnDiskSafetensorCheckpoints } from '@shared/checkpoints'
import { datasetFullyCaptioned, missingCaptionCount } from '@shared/schemas/dataset'
import { ConfigForm } from '../components/ConfigForm'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { JobBreadcrumb } from '../components/JobBreadcrumb'
import {
  DatasetHoverPreviewCard,
  useDatasetHoverPreview
} from '../components/DatasetHoverPreview'
import { useConfirm } from '../components/useConfirm'
import {
  countCaptionsMissingTrigger,
  fixMissingTriggers
} from '../components/createJobTriggerGate'
import { unwrap, useAppStore } from '../store'
import { isEditableKeyboardTarget, cycleIndex } from '../util/listKeyboard'
import { useClampedMenuPosition } from '../util/contextMenuPosition'
import { revealJobFolder } from '../util/revealJobFolder'

const AUTOSAVE_MS = 450

type JobFilter = 'new' | 'completed' | 'archived'

const FILTER_STORAGE_KEY = 'lora-training:jobs-filter'

function loadFilter(): JobFilter {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY)
    if (raw === 'new' || raw === 'completed' || raw === 'archived') return raw
  } catch {
    /* ignore */
  }
  return 'new'
}

function matchesFilter(job: JobSummary, filter: JobFilter, status: JobSummary['status'] = job.status): boolean {
  if (filter === 'archived') return job.archived
  // Completed = finished but not shelved (may still resume)
  if (filter === 'completed') return status === 'complete' && !job.archived
  // New / todo: not finished training, and not shelved
  return !job.archived && status !== 'complete'
}

/** Prefer live queue snapshot over a jobs.list() that can briefly lag after enqueue. */
function jobStatusFromQueue(
  job: JobSummary,
  queue: QueueSnapshot | null | undefined
): JobSummary['status'] {
  const fromQueue = queue?.statuses[job.id]
  if (fromQueue && queue?.jobIds.includes(job.id)) return fromQueue
  return job.status
}

function jobEditSnapshot(detail: {
  datasetId: string
  config: unknown
}): string {
  return JSON.stringify({
    datasetId: detail.datasetId,
    config: detail.config
  })
}

function multiEditSnapshot(details: Array<{ id: string; config: unknown }>): string {
  return JSON.stringify(
    details.map((d) => ({
      id: d.id,
      config: d.config
    }))
  )
}

export function JobsScreen(): React.JSX.Element {
  const jobs = useAppStore((s) => s.jobs)
  const datasets = useAppStore((s) => s.datasets)
  const categories = useAppStore((s) => s.categories)
  const detail = useAppStore((s) => s.jobDetail)
  const selectedId = useAppStore((s) => s.selectedJobId)
  const queue = useAppStore((s) => s.queue)
  const loadJob = useAppStore((s) => s.loadJob)
  const loadDataset = useAppStore((s) => s.loadDataset)
  const setScreen = useAppStore((s) => s.setScreen)
  const openQueueForJob = useAppStore((s) => s.openQueueForJob)
  const setDatasetsMiddleTab = useAppStore((s) => s.setDatasetsMiddleTab)
  const setStatus = useAppStore((s) => s.setStatus)
  const setError = useAppStore((s) => s.setError)
  const { ask, dialog } = useConfirm()
  const { preview: datasetHoverPreview, bind: bindDatasetHover } = useDatasetHoverPreview()
  const [pickOpen, setPickOpen] = useState(false)
  const [pickDatasetId, setPickDatasetId] = useState('')
  const [triggerGap, setTriggerGap] = useState<{
    datasetId: string
    trigger: string
    missing: number
    name: string
  } | null>(null)
  const [triggerGapBusy, setTriggerGapBusy] = useState(false)
  const [filter, setFilter] = useState<JobFilter>(() => loadFilter())
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving'>('saved')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null)
  const [multiDetails, setMultiDetails] = useState<JobDetail[] | null>(null)
  const [multiSavedSnapshot, setMultiSavedSnapshot] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    jobId: string
    datasetId: string
  } | null>(null)
  const { menuRef: jobsMenuRef, menuStyle: jobsMenuStyle } = useClampedMenuPosition(
    contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null
  )
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveGen = useRef(0)
  const detailRef = useRef(detail)
  const savedSnapshotRef = useRef(savedSnapshot)
  const multiDetailsRef = useRef(multiDetails)
  const multiSavedSnapshotRef = useRef(multiSavedSnapshot)
  const selectedIdsRef = useRef(selectedIds)
  const selectedItemRef = useRef<HTMLButtonElement | null>(null)
  detailRef.current = detail
  savedSnapshotRef.current = savedSnapshot
  multiDetailsRef.current = multiDetails
  multiSavedSnapshotRef.current = multiSavedSnapshot
  selectedIdsRef.current = selectedIds

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const multiEdit = selectedIds.length > 1

  const datasetsById = useMemo(() => new Map(datasets.map((d) => [d.id, d])), [datasets])

  const readyDatasets = useMemo(
    () =>
      datasets.filter(
        (d) => d.ready && datasetFullyCaptioned(d.stats) && !datasetHasOpenJob(jobs, d.id)
      ),
    [datasets, jobs]
  )

  /** Ready datasets for the Folder/Dataset picker (plus the job’s current link). */
  const jobDatasetOptions = useMemo(() => {
    if (!detail) return []
    const others = jobs.filter((j) => j.id !== detail.id)
    return datasets
      .filter(
        (d) =>
          d.id === detail.datasetId ||
          (d.ready && !datasetHasOpenJob(others, d.id))
      )
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      .map((d) => ({ id: d.id, name: d.name, folderPath: d.folderPath }))
  }, [datasets, jobs, detail])

  const jobDirty =
    multiEdit
      ? multiDetails != null &&
        multiSavedSnapshot != null &&
        multiEditSnapshot(multiDetails) !== multiSavedSnapshot
      : detail != null &&
        savedSnapshot != null &&
        jobEditSnapshot(detail) !== savedSnapshot

  const configLocked = multiEdit
    ? multiDetails != null &&
      multiDetails.some(
        (d) => d.status === 'running' || queue?.runningJobId === d.id
      )
    : detail != null &&
      (detail.status === 'running' || queue?.runningJobId === detail.id)

  /** Identity fields lock only once the dataset output has a real on-disk `.safetensors`. */
  const [hasOutputCheckpoints, setHasOutputCheckpoints] = useState(false)
  const identityLocked = hasOutputCheckpoints

  useEffect(() => {
    const datasetId = detail?.datasetId
    if (!datasetId) {
      setHasOutputCheckpoints(false)
      return
    }
    let cancelled = false
    void window.loraTraining.datasets
      .listOutputs(datasetId)
      .then((r) => {
        if (cancelled) return
        try {
          const outs = unwrap(r) as {
            checkpoints: Array<{ fileName: string; pending?: boolean }>
          }
          // listOutputs also returns synthetic "pending" rows for planned steps —
          // those are not on disk and must not lock identity fields on a new job.
          setHasOutputCheckpoints(hasOnDiskSafetensorCheckpoints(outs.checkpoints))
        } catch {
          setHasOutputCheckpoints(false)
        }
      })
      .catch(() => {
        if (!cancelled) setHasOutputCheckpoints(false)
      })
    return () => {
      cancelled = true
    }
    // Re-check when status/checkpoint progress changes (first save may appear mid-session).
  }, [detail?.datasetId, detail?.id, detail?.status, detail?.checkpointStep])

  const detailId = detail?.id ?? null
  const multiIdsKey = selectedIds.join('\0')

  // Treat a freshly selected job as clean (single-select).
  useEffect(() => {
    if (multiEdit) return
    saveGen.current += 1
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (!detailId || !detailRef.current || detailRef.current.id !== detailId) {
      setSavedSnapshot(null)
      setSaveStatus('saved')
      return
    }
    setSavedSnapshot(jobEditSnapshot(detailRef.current))
    setSaveStatus('saved')
  }, [detailId, multiEdit])

  // Load multi-edit details when selection has 2+ jobs.
  useEffect(() => {
    if (!multiEdit) {
      setMultiDetails(null)
      setMultiSavedSnapshot(null)
      return
    }
    let cancelled = false
    const ids = [...selectedIds]
    setMultiDetails(null)
    setMultiSavedSnapshot(null)
    setSaveStatus('saved')
    void (async () => {
      try {
        const loaded: JobDetail[] = []
        for (const id of ids) {
          const d = unwrap(await window.loraTraining.jobs.get(id)) as JobDetail
          if (cancelled) return
          loaded.push(d)
        }
        if (cancelled) return
        setMultiDetails(loaded)
        setMultiSavedSnapshot(multiEditSnapshot(loaded))
        setSaveStatus('saved')
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setMultiDetails(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
     
  }, [multiIdsKey, multiEdit])

  async function flushSave(): Promise<boolean> {
    if (multiEdit) {
      const details = multiDetailsRef.current
      const baseline = multiSavedSnapshotRef.current
      if (!details || baseline == null) return true
      const snap = multiEditSnapshot(details)
      if (snap === baseline) return true

      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
      }

      const gen = ++saveGen.current
      setSaveStatus('saving')
      try {
        const updatedList: JobDetail[] = []
        for (const d of details) {
          const updated = unwrap(
            await window.loraTraining.jobs.update({
              id: d.id,
              datasetId: d.datasetId,
              config: d.config
            })
          ) as JobDetail
          updatedList.push({
            ...updated,
            config: d.config
          })
        }
        if (saveGen.current !== gen) return false
        setMultiSavedSnapshot(snap)
        useAppStore.setState((s) => {
          const byId = new Map(updatedList.map((u) => [u.id, u]))
          let queue = s.queue
          if (queue) {
            let totalSteps = { ...queue.totalSteps }
            let jobIds = queue.jobIds
            let statuses = { ...queue.statuses }
            for (const updated of updatedList) {
              if (!queue.jobIds.includes(updated.id)) continue
              if (updated.status === 'complete') {
                jobIds = jobIds.filter((qid) => qid !== updated.id)
                const { [updated.id]: _s, ...restStatuses } = statuses
                statuses = restStatuses
                const { [updated.id]: _t, ...restSteps } = totalSteps
                totalSteps = restSteps
              } else if (updated.totalSteps > 0) {
                totalSteps = { ...totalSteps, [updated.id]: updated.totalSteps }
              }
            }
            queue = { ...queue, jobIds, statuses, totalSteps }
          }
          return {
            jobs: s.jobs.map((j) => {
              const updated = byId.get(j.id)
              if (!updated) return j
              return {
                ...j,
                name: updated.name,
                datasetId: updated.datasetId,
                archived: updated.archived,
                updatedAt: updated.updatedAt,
                totalSteps: updated.totalSteps,
                status: updated.status,
                progress: updated.progress,
                checkpointStep: updated.checkpointStep
              }
            }),
            queue
          }
        })
        if (saveGen.current !== gen) return false
        setSaveStatus('saved')
        return true
      } catch (err) {
        if (saveGen.current === gen) setSaveStatus('saved')
        setError(err instanceof Error ? err.message : String(err))
        return false
      }
    }

    const d = detailRef.current
    const baseline = savedSnapshotRef.current
    if (!d || baseline == null) return true
    const snap = jobEditSnapshot(d)
    if (snap === baseline) return true

    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }

    const gen = ++saveGen.current
    const id = d.id
    setSaveStatus('saving')
    try {
      const updated = unwrap(
        await window.loraTraining.jobs.update({
          id,
          datasetId: d.datasetId,
          config: d.config
        })
      ) as JobDetail
      if (saveGen.current !== gen) return false
      const now = detailRef.current
      if (now && now.id === id) {
        // Baseline = what we wrote; further keystrokes keep the form dirty for the next debounce.
        setSavedSnapshot(snap)
      }
      // Patch lists + queue step cache in place — never refreshAll on autosave.
      useAppStore.setState((s) => {
        let queue = s.queue
        if (queue?.jobIds.includes(id)) {
          if (updated.status === 'complete') {
            queue = {
              ...queue,
              jobIds: queue.jobIds.filter((qid) => qid !== id),
              statuses: Object.fromEntries(
                Object.entries(queue.statuses).filter(([qid]) => qid !== id)
              ),
              totalSteps: Object.fromEntries(
                Object.entries(queue.totalSteps ?? {}).filter(([qid]) => qid !== id)
              )
            }
          } else if (updated.totalSteps > 0) {
            queue = {
              ...queue,
              totalSteps: { ...queue.totalSteps, [id]: updated.totalSteps }
            }
          }
        }
        return {
          jobDetail:
            s.jobDetail?.id === id
              ? { ...s.jobDetail, ...updated, config: s.jobDetail.config }
              : s.jobDetail,
          jobs: s.jobs.map((j) =>
            j.id === id
              ? {
                  ...j,
                  name: updated.name,
                  datasetId: updated.datasetId,
                  archived: updated.archived,
                  updatedAt: updated.updatedAt,
                totalSteps: updated.totalSteps,
                status: updated.status,
                progress: updated.progress,
                checkpointStep: updated.checkpointStep
              }
              : j
          ),
          queue
        }
      })
      if (saveGen.current !== gen) return false
      setSaveStatus('saved')
      return true
    } catch (err) {
      if (saveGen.current === gen) setSaveStatus('saved')
      setError(err instanceof Error ? err.message : String(err))
      return false
    }
  }

  // Debounced autosave whenever dataset/config diverge from last saved snapshot.
  useEffect(() => {
    if (!jobDirty || configLocked) return
    if (multiEdit && !multiDetails) return
    if (!multiEdit && !detail) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      void flushSave()
    }, AUTOSAVE_MS)
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
      }
    }
  }, [jobDirty, detail, savedSnapshot, multiDetails, multiSavedSnapshot, configLocked, multiEdit])

  const categoryNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of categories) map.set(c.id, c.name)
    return map
  }, [categories])

  function partsForJob(j: Pick<JobSummary, 'datasetId' | 'name'>): {
    categoryName: string
    datasetName: string
    label: string
  } {
    const ds = datasets.find((d) => d.id === j.datasetId)
    const datasetName = ds?.name ?? j.name
    const categoryName = ds ? categoryNameById.get(ds.categoryId) : undefined
    const parts = jobBreadcrumbParts(categoryName, datasetName)
    return {
      categoryName: parts.category,
      datasetName: parts.dataset,
      label: jobBreadcrumbLabel(categoryName, datasetName)
    }
  }

  function labelForJob(j: Pick<JobSummary, 'datasetId' | 'name'>): string {
    return partsForJob(j).label
  }

  const filteredJobs = useMemo(
    () =>
      jobs
        .filter((j) => matchesFilter(j, filter, jobStatusFromQueue(j, queue)))
        .slice()
        .sort((a, b) =>
          labelForJob(a).localeCompare(labelForJob(b), undefined, { sensitivity: 'base' })
        ),
    // labelForJob closes over datasets/categories; include those deps.
     
    [jobs, filter, datasets, categoryNameById, queue]
  )

  const orderedIds = useMemo(() => filteredJobs.map((j) => j.id), [filteredJobs])

  // Drop selection entries that left the current filter/list.
  useEffect(() => {
    setSelectedIds((prev) => {
      const next = orderedIds.filter((id) => prev.includes(id))
      if (next.length === prev.length && next.every((id, i) => id === prev[i])) return prev
      return next
    })
    setSelectionAnchorId((prev) => (prev && orderedIds.includes(prev) ? prev : null))
  }, [orderedIds])

  // If multi-select has ids but store focus is missing/outside the set, pick a
  // valid focus. Do not overwrite a focus that is already in the selection —
  // that used to fight the tab-sync effect (anchor ↔ selectedJobId ping-pong →
  // "Maximum update depth exceeded").
  useEffect(() => {
    if (selectedIds.length <= 1) return
    if (selectedId && selectedSet.has(selectedId)) return
    const focus =
      selectionAnchorId && selectedSet.has(selectionAnchorId)
        ? selectionAnchorId
        : selectedIds[0] ?? null
    if (focus != null && focus !== selectedId) {
      useAppStore.setState({ selectedJobId: focus })
    }
  }, [selectedIds, selectionAnchorId, selectedSet, selectedId])

  const counts = useMemo(() => {
    let neu = 0
    let completed = 0
    let archived = 0
    for (const j of jobs) {
      if (j.archived) archived++
      else if (j.status === 'complete') completed++
      else neu++
    }
    return { new: neu, completed, archived }
  }, [jobs])

  function changeFilter(next: JobFilter): void {
    setFilter(next)
    try {
      localStorage.setItem(FILTER_STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
    // Don't keep a selection that belongs to another tab — that used to snap the
    // filter back via the sync effect below.
    const keep = selectedIds.filter((id) => {
      const job = jobs.find((j) => j.id === id)
      return job ? matchesFilter(job, next) : false
    })
    if (keep.length !== selectedIds.length) {
      setSelectedIds(keep)
      setSelectionAnchorId((prev) => (prev && keep.includes(prev) ? prev : keep[0] ?? null))
      if (keep.length === 0) {
        useAppStore.setState({ selectedJobId: null, jobDetail: null })
        setMultiDetails(null)
      } else if (keep.length === 1) {
        void loadJob(keep[0]!)
      }
    }
  }

  // When a job is selected (e.g. from Queue), switch to the tab that contains it.
  // Do not depend on `filter` — otherwise clicking New/Completed while an archived
  // job is selected immediately forces Archived again.
  // If store focus is already inside the current selection (multi-select), leave
  // ids/anchor alone — overwriting the anchor used to ping-pong with the store
  // focus effect ("Maximum update depth exceeded" on Shift/Ctrl multi-select).
  useEffect(() => {
    if (!selectedId) return
    const job = jobs.find((j) => j.id === selectedId)
    if (!job) return
    if (selectedIdsRef.current.includes(selectedId)) {
      // Still move tabs when the focused job's status warrants it (e.g. completed),
      // but never clobber multi-select anchor/ids.
      const desired: JobFilter = job.archived
        ? 'archived'
        : job.status === 'complete'
          ? 'completed'
          : 'new'
      setFilter((current) => {
        if (current === desired) return current
        try {
          localStorage.setItem(FILTER_STORAGE_KEY, desired)
        } catch {
          /* ignore */
        }
        return desired
      })
      return
    }
    if (job.archived) changeFilter('archived')
    else if (job.status === 'complete') changeFilter('completed')
    else changeFilter('new')
    setSelectedIds([selectedId])
    setSelectionAnchorId(selectedId)
     
  }, [selectedId, jobs])

  useEffect(() => {
    const focusId =
      selectionAnchorId && selectedSet.has(selectionAnchorId)
        ? selectionAnchorId
        : selectedIds[0] ?? null
    if (!focusId) return
    const frame = window.requestAnimationFrame(() => {
      selectedItemRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [selectionAnchorId, selectedIds, selectedSet, filter, filteredJobs])

  async function finishCreateJob(datasetId: string, name: string): Promise<void> {
    const created = unwrap(
      await window.loraTraining.jobs.create({ name, datasetId })
    ) as JobDetail
    changeFilter('new')
    setSelectedIds([created.id])
    setSelectionAnchorId(created.id)
    setMultiDetails(null)
    useAppStore.setState((s) => ({
      jobs: [created, ...s.jobs.filter((j) => j.id !== created.id)],
      selectedJobId: created.id,
      jobDetail: created,
      error: null
    }))
    setStatus(`Created job “${name}”`)
    void useAppStore.getState().refreshJobs()
  }

  async function createJobForDataset(datasetId: string): Promise<void> {
    const ds = datasets.find((d) => d.id === datasetId)
    if (!ds) {
      setError('Dataset not found.')
      return
    }
    if (!ds.ready) {
      setError('Mark the dataset Ready before creating a job.')
      return
    }
    if (!datasetFullyCaptioned(ds.stats)) {
      const missing = missingCaptionCount(ds.stats)
      setError(
        missing > 0
          ? `Cannot create a job: ${missing} image${missing === 1 ? '' : 's'} still missing captions`
          : 'Cannot create a job: dataset has no images'
      )
      return
    }
    const existing = openJobForDataset(jobs, datasetId)
    if (existing) {
      changeFilter('new')
      await loadJob(existing.id)
      setStatus(`Opened existing job for “${ds.name}”`)
      return
    }
    try {
      const trigger = ds.trigger.trim()
      if (trigger) {
        setStatus('Checking captions for trigger…')
        const missing = await countCaptionsMissingTrigger(datasetId, trigger)
        if (missing > 0) {
          setTriggerGap({ datasetId, trigger, missing, name: ds.name })
          setStatus('')
          return
        }
      }
      await finishCreateJob(datasetId, ds.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function createJobAfterTriggerChoice(choice: 'fix' | 'create'): Promise<void> {
    if (!triggerGap) return
    const { datasetId, name } = triggerGap
    setTriggerGapBusy(true)
    try {
      if (choice === 'fix') {
        setStatus('Prepending missing triggers…')
        const result = await fixMissingTriggers(datasetId, triggerGap.trigger)
        setStatus(`Prepended trigger to ${result.changed} caption${result.changed === 1 ? '' : 's'}`)
      }
      setTriggerGap(null)
      await finishCreateJob(datasetId, name)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setTriggerGapBusy(false)
    }
  }

  async function beginNewJob(): Promise<void> {
    if (datasets.length === 0) {
      setError('Add a dataset first.')
      return
    }
    if (readyDatasets.length === 0) {
      setError(
        'No Ready datasets with full captions and no open job. Caption every image, mark Ready, or finish/archive its existing job.'
      )
      return
    }
    if (readyDatasets.length === 1) {
      await createJobForDataset(readyDatasets[0]!.id)
      return
    }
    const selected = useAppStore.getState().selectedDatasetId
    const preferred =
      readyDatasets.find((d) => d.id === selected)?.id ?? readyDatasets[0]!.id
    setPickDatasetId(preferred)
    setPickOpen(true)
  }

  // Export YAML kept for possible future use — not shown in the toolbar.
  // async function exportYaml(): Promise<void> {
  //   if (!selectedId) return
  //   const { yaml } = unwrap(await window.loraTraining.jobs.exportYamlText(selectedId)) as {
  //     yaml: string
  //   }
  //   try {
  //     await navigator.clipboard.writeText(yaml)
  //     setStatus('YAML copied to clipboard')
  //   } catch {
  //     setStatus('YAML preview ready')
  //   }
  // }

  async function enqueue(): Promise<void> {
    const ids = multiEdit ? selectedIds : selectedId ? [selectedId] : []
    if (ids.length === 0) return
    try {
      const ok = await flushSave()
      if (!ok) return
      const lastQueue = unwrap(
        await window.loraTraining.queue.enqueueMany(ids)
      ) as QueueSnapshot
      const idSet = new Set(ids)
      useAppStore.setState((s) => ({
        queue: lastQueue,
        jobs: s.jobs.map((j) =>
          idSet.has(j.id) ? { ...j, status: 'queued' as const } : j
        ),
        jobDetail:
          s.jobDetail && idSet.has(s.jobDetail.id)
            ? { ...s.jobDetail, status: 'queued' as const }
            : s.jobDetail,
        screen: 'queue',
        queueFocusJobId: ids[ids.length - 1] ?? null,
        error: null
      }))
      setStatus(ids.length === 1 ? 'Job enqueued' : `${ids.length} jobs enqueued`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function selectJob(id: string): Promise<void> {
    await flushSave()
    setSelectedIds([id])
    setSelectionAnchorId(id)
    setMultiDetails(null)
    await loadJob(id)
  }

  function selectJobsItem(e: React.MouseEvent, id: string): void {
    const additive = e.ctrlKey || e.metaKey
    const range = e.shiftKey

    void (async () => {
      await flushSave()

      if (range && selectionAnchorId) {
        const span = rangeIdsInclusive(orderedIds, selectionAnchorId, id)
        let next: string[]
        if (additive) {
          const set = new Set(selectedIds)
          for (const x of span) set.add(x)
          next = orderedIds.filter((x) => set.has(x))
        } else {
          next = span
        }
        setSelectedIds(next)
        if (next.length === 1) {
          setMultiDetails(null)
          await loadJob(next[0]!)
        } else if (next.length === 0) {
          setMultiDetails(null)
          useAppStore.setState({ selectedJobId: null, jobDetail: null })
        } else {
          useAppStore.setState({ selectedJobId: id })
        }
        return
      }

      if (additive) {
        const set = new Set(selectedIds)
        if (set.has(id)) set.delete(id)
        else set.add(id)
        const next = orderedIds.filter((x) => set.has(x))
        setSelectedIds(next)
        setSelectionAnchorId(id)
        if (next.length === 1) {
          setMultiDetails(null)
          await loadJob(next[0]!)
        } else if (next.length === 0) {
          setMultiDetails(null)
          useAppStore.setState({ selectedJobId: null, jobDetail: null })
        } else {
          useAppStore.setState({ selectedJobId: id })
        }
        return
      }

      setSelectedIds([id])
      setSelectionAnchorId(id)
      setMultiDetails(null)
      await loadJob(id)
    })()
  }

  async function openDatasetForJob(jobId: string, datasetId: string): Promise<void> {
    setScreen('datasets')
    await loadDataset(datasetId)
    setDatasetsMiddleTab('images')
  }

  async function revealJob(jobId: string, datasetId: string): Promise<void> {
    const job = jobs.find((j) => j.id === jobId)
    try {
      const where = await revealJobFolder({
        datasetId,
        hasCheckpoints: (job?.checkpointStep ?? 0) > 0
      })
      setStatus(where === 'output' ? 'Opened output folder' : 'Opened dataset folder')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function openJobsContextMenu(
    e: React.MouseEvent,
    jobId: string,
    datasetId: string
  ): void {
    e.preventDefault()
    e.stopPropagation()
    if (!selectedSet.has(jobId)) {
      void selectJob(jobId)
    }
    setContextMenu({ x: e.clientX, y: e.clientY, jobId, datasetId })
  }

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isEditableKeyboardTarget(e.target)) return
      if (pickOpen || triggerGap) return
      if (e.key === 'Escape' && contextMenu) {
        setContextMenu(null)
        return
      }
      if (contextMenu) return
      if (e.key === 'Escape') {
        if (selectedIds.length === 0) return
        e.preventDefault()
        setSelectedIds([])
        setSelectionAnchorId(null)
        setMultiDetails(null)
        useAppStore.setState({ selectedJobId: null, jobDetail: null })
        return
      }
      if (filteredJobs.length === 0) return

      const focusId =
        selectionAnchorId && selectedSet.has(selectionAnchorId)
          ? selectionAnchorId
          : selectedIds[0] ?? null
      const idx = focusId ? filteredJobs.findIndex((j) => j.id === focusId) : -1

      if (e.key === 'Home') {
        e.preventDefault()
        const first = filteredJobs[0]
        if (first) void selectJob(first.id)
        return
      }
      if (e.key === 'End') {
        e.preventDefault()
        const last = filteredJobs[filteredJobs.length - 1]
        if (last) void selectJob(last.id)
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const nextIdx = cycleIndex(
          filteredJobs.length,
          idx,
          e.key === 'ArrowDown' ? 1 : -1
        )
        const next = filteredJobs[nextIdx]
        if (next) void selectJob(next.id)
        return
      }
      if (e.key === 'Enter') {
        if (idx < 0) return
        const job = filteredJobs[idx]
        if (!job) return
        e.preventDefault()
        void openDatasetForJob(job.id, job.datasetId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    filteredJobs,
    selectedId,
    selectedIds,
    selectionAnchorId,
    selectedSet,
    pickOpen,
    triggerGap,
    contextMenu
  ])

  async function setArchived(archived: boolean): Promise<void> {
    const targets = multiEdit
      ? multiDetails ?? []
      : detail
        ? [detail]
        : []
    if (targets.length === 0) return
    try {
      const ok = await flushSave()
      if (!ok) return
      const idSet = new Set(targets.map((t) => t.id))
      for (const t of targets) {
        unwrap(await window.loraTraining.jobs.update({ id: t.id, archived }))
      }
      useAppStore.setState((s) => ({
        jobs: s.jobs.map((j) => (idSet.has(j.id) ? { ...j, archived } : j)),
        jobDetail:
          s.jobDetail && idSet.has(s.jobDetail.id)
            ? { ...s.jobDetail, archived }
            : s.jobDetail
      }))
      if (multiEdit && multiDetails) {
        const next = multiDetails.map((d) => ({ ...d, archived }))
        setMultiDetails(next)
        setMultiSavedSnapshot(multiEditSnapshot(next))
      } else if (detail) {
        setSavedSnapshot(jobEditSnapshot(detail))
      }
      setSaveStatus('saved')
      const label =
        targets.length === 1
          ? `“${labelForJob(targets[0]!)}”`
          : `${targets.length} jobs`
      setStatus(archived ? `Archived ${label}` : `Restored ${label} from archive`)
      if (archived) changeFilter('archived')
      else if (targets.every((t) => t.status === 'complete')) changeFilter('completed')
      else changeFilter('new')
      void useAppStore.getState().refreshJobs()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="screen jobs-screen">
      {dialog}
      <ConfirmDialog
        open={pickOpen}
        title="New job"
        confirmLabel="Create"
        onCancel={() => setPickOpen(false)}
        onConfirm={() => {
          void (async () => {
            setPickOpen(false)
            if (pickDatasetId) await createJobForDataset(pickDatasetId)
          })()
        }}
      >
        <div className="form-grid form-rows">
          <p className="hint" style={{ margin: 0 }}>
            Multiple datasets are marked Ready. Choose which one this job trains.
          </p>
          <label className="field-row">
            <span className="field-label">Dataset</span>
            <select
              value={pickDatasetId}
              onChange={(e) => setPickDatasetId(e.target.value)}
            >
              {readyDatasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        open={Boolean(triggerGap)}
        title="Missing trigger in captions"
        confirmLabel="Create"
        leftActionLabel="Fix missing"
        leftActionTitle={`Prepend “${triggerGap?.trigger ?? 'trigger'}, ” only to captions that lack the dataset trigger, then create the job (same as Ensure Trigger).`}
        dismissDisabled={triggerGapBusy}
        autoFocusConfirm
        enterConfirms
        onLeftAction={() => {
          if (triggerGapBusy) return
          void createJobAfterTriggerChoice('fix')
        }}
        onConfirm={() => {
          if (triggerGapBusy) return
          void createJobAfterTriggerChoice('create')
        }}
        onCancel={() => {
          if (triggerGapBusy) return
          setTriggerGap(null)
        }}
      >
        <p>
          {triggerGap
            ? `${triggerGap.missing} caption${triggerGap.missing === 1 ? '' : 's'} do not contain the trigger “${triggerGap.trigger}”. All captions should include it, but you can still create the job without fixing.`
            : null}
        </p>
      </ConfirmDialog>

      <div className="panel jobs-list-panel">
        <div className="jobs-list-header">
          <h2 className="section-title">Jobs</h2>
          <button
            type="button"
            className="icon-btn primary"
            title="New job"
            aria-label="New job"
            onClick={() => void beginNewJob()}
          >
            <Plus size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <div className="jobs-filter" role="tablist" aria-label="Job filters">
          {(
            [
              { id: 'new' as const, label: 'New', count: counts.new },
              { id: 'completed' as const, label: 'Completed', count: counts.completed },
              { id: 'archived' as const, label: 'Archived', count: counts.archived }
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={filter === tab.id}
              className={`jobs-filter-btn${filter === tab.id ? ' active' : ''}`}
              onClick={() => changeFilter(tab.id)}
            >
              {tab.label}
              <span className="jobs-filter-count">{tab.count}</span>
            </button>
          ))}
        </div>
        {filteredJobs.length === 0 ? (
          <div className="empty">
            {filter === 'new'
              ? 'No open jobs.'
              : filter === 'completed'
                ? 'No completed jobs.'
                : 'No archived jobs.'}
          </div>
        ) : (
          <div className="list">
            {filteredJobs.map((j) => {
              const ds = datasetsById.get(j.datasetId)
              const hover = bindDatasetHover(ds)
              const isSelected = selectedSet.has(j.id)
              const isFocus =
                selectionAnchorId === j.id ||
                (selectedIds.length === 1 && selectedIds[0] === j.id)
              return (
              <button
                key={j.id}
                ref={isFocus ? selectedItemRef : undefined}
                type="button"
                className={`list-item jobs-list-item${isSelected ? ' active' : ''}`}
                onMouseDown={(e) => {
                  if (e.shiftKey || e.ctrlKey || e.metaKey) e.preventDefault()
                }}
                onClick={(e) => selectJobsItem(e, j.id)}
                onMouseEnter={hover.onMouseEnter}
                onMouseMove={hover.onMouseMove}
                onMouseLeave={hover.onMouseLeave}
                onDoubleClick={() => {
                  void openDatasetForJob(j.id, j.datasetId)
                }}
                onContextMenu={(e) => openJobsContextMenu(e, j.id, j.datasetId)}
              >
                <span className="jobs-list-name">
                  <JobBreadcrumb
                    categoryName={partsForJob(j).categoryName}
                    datasetName={partsForJob(j).datasetName}
                  />
                </span>
                {(() => {
                  const steps = resolveJobTotalSteps({
                    totalSteps: j.totalSteps,
                    progressTotalSteps: j.progress?.totalSteps,
                    status: j.status
                  })
                  if (steps <= 0) return null
                  const current = resolveJobStepsLabelCurrent({
                    status: j.status,
                    checkpointStep: j.checkpointStep,
                    progressCurrentStep: j.progress?.currentStep,
                    progress: j.progress
                  })
                  const label = formatJobStepsLabel(current, steps)
                  return (
                    <span
                      className="jobs-list-steps"
                      title={
                        current > 0
                          ? `Latest checkpoint ${label}`
                          : 'Configured training steps'
                      }
                    >
                      {label}
                    </span>
                  )
                })()}
                <span className="jobs-list-pills">
                  {(() => {
                    const status = jobStatusFromQueue(j, queue)
                    return <span className={`status-pill ${status}`}>{status}</span>
                  })()}
                  {j.archived ? <span className="status-pill archived">archived</span> : null}
                </span>
              </button>
              )
            })}
          </div>
        )}
      </div>

      <DatasetHoverPreviewCard preview={datasetHoverPreview} />

      {contextMenu
        ? (() => {
            const job = jobs.find((j) => j.id === contextMenu.jobId)
            const status = job ? jobStatusFromQueue(job, queue) : null
            const inQueue = status ? isQueuedJobStatus(status) : false
            const hasCheckpoints = (job?.checkpointStep ?? 0) > 0
            return (
              <div
                ref={jobsMenuRef}
                className="context-menu"
                style={jobsMenuStyle}
                role="menu"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="context-menu-item"
                  title={
                    hasCheckpoints
                      ? 'Open the dataset output folder (checkpoints)'
                      : 'Open the dataset folder on disk'
                  }
                  onClick={() => {
                    const { jobId, datasetId } = contextMenu
                    setContextMenu(null)
                    void revealJob(jobId, datasetId)
                  }}
                >
                  Reveal in Explorer
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="context-menu-item"
                  title={
                    inQueue
                      ? 'Open this job on the Queue screen'
                      : 'Enqueue this job before opening the Queue'
                  }
                  disabled={!inQueue}
                  onClick={() => {
                    if (!inQueue) return
                    const { jobId } = contextMenu
                    setContextMenu(null)
                    openQueueForJob(jobId)
                  }}
                >
                  Open Queue
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="context-menu-item"
                  title="Open the linked dataset in the Datasets screen"
                  onClick={() => {
                    const { jobId, datasetId } = contextMenu
                    setContextMenu(null)
                    void openDatasetForJob(jobId, datasetId)
                  }}
                >
                  Open Dataset
                </button>
              </div>
            )
          })()
        : null}

      <div className="panel jobs-detail-panel" style={{ overflow: 'auto' }}>
        {multiEdit ? (
          !multiDetails ? (
            <div className="empty">Loading {selectedIds.length} jobs…</div>
          ) : (
            <>
              <div className="jobs-detail-header">
                <div className="toolbar">
                  <button
                    type="button"
                    className="primary"
                    disabled={configLocked}
                    title={
                      configLocked
                        ? 'Stop training before enqueueing changes'
                        : `Enqueue ${multiDetails.length} jobs`
                    }
                    onClick={() => void enqueue()}
                  >
                    Enqueue ({multiDetails.length})
                  </button>
                  <button
                    type="button"
                    disabled
                    title="Duplicate one job at a time"
                  >
                    Duplicate
                  </button>
                  {multiDetails.every((d) => d.archived) ? (
                    <button
                      type="button"
                      disabled={configLocked}
                      onClick={() => void setArchived(false)}
                    >
                      Unarchive ({multiDetails.length})
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={configLocked}
                      onClick={() => void setArchived(true)}
                    >
                      Archive ({multiDetails.length})
                    </button>
                  )}
                  <button
                    type="button"
                    className="danger"
                    disabled={configLocked}
                    title={
                      configLocked
                        ? 'Stop training before deleting'
                        : `Delete ${multiDetails.length} jobs`
                    }
                    onClick={() => {
                      void (async () => {
                        const ok = await ask({
                          title: 'Delete jobs?',
                          message: `Delete ${multiDetails.length} jobs? Datasets and LoRA outputs are kept.`,
                          confirmLabel: 'Delete',
                          danger: true
                        })
                        if (!ok) return
                        if (saveTimer.current) {
                          clearTimeout(saveTimer.current)
                          saveTimer.current = null
                        }
                        saveGen.current += 1
                        const removeIds = multiDetails.map((d) => d.id)
                        const removeSet = new Set(removeIds)
                        for (const id of removeIds) {
                          unwrap(await window.loraTraining.jobs.remove(id))
                        }
                        setSelectedIds([])
                        setSelectionAnchorId(null)
                        setMultiDetails(null)
                        useAppStore.setState((s) => ({
                          selectedJobId: null,
                          jobDetail: null,
                          jobs: s.jobs.filter((j) => !removeSet.has(j.id)),
                          queue: s.queue
                            ? {
                                ...s.queue,
                                jobIds: s.queue.jobIds.filter((id) => !removeSet.has(id)),
                                statuses: Object.fromEntries(
                                  Object.entries(s.queue.statuses).filter(
                                    ([id]) => !removeSet.has(id)
                                  )
                                ),
                                totalSteps: Object.fromEntries(
                                  Object.entries(s.queue.totalSteps ?? {}).filter(
                                    ([id]) => !removeSet.has(id)
                                  )
                                ),
                                runningJobId:
                                  s.queue.runningJobId && removeSet.has(s.queue.runningJobId)
                                    ? null
                                    : s.queue.runningJobId
                              }
                            : s.queue
                        }))
                        void useAppStore.getState().refreshJobs()
                      })()
                    }}
                  >
                    Delete ({multiDetails.length})
                  </button>
                </div>
                <span className="jobs-save-status" aria-live="polite">
                  {configLocked ? 'Read-only' : saveStatus === 'saving' ? 'Saving…' : 'Saved'}
                </span>
              </div>
              <h2 className="jobs-detail-title">
                {multiDetails.length} jobs selected
              </h2>
              {configLocked ? (
                <p className="hint jobs-running-lock" role="status">
                  One or more selected jobs are training — settings are read-only. Stop them from
                  the Queue tab to edit.
                </p>
              ) : (
                <p className="hint jobs-running-lock" role="status">
                  LoRA name, trigger, and dataset stay per-job and are locked. Changing any other
                  field applies it to every selected job (differing values are left alone until you
                  edit that field). Checkpoint and VRAM options are in Settings → Training model.
                </p>
              )}
              <div style={{ marginTop: '0.75rem' }}>
                <ConfigForm
                  disabled={configLocked}
                  lockPerJobFields
                  value={multiDetails[0]!.config as TrainingConfig}
                  datasetSelect={{
                    options: [
                      {
                        id: multiDetails[0]!.datasetId,
                        name: '(per job)',
                        folderPath: ''
                      }
                    ],
                    value: multiDetails[0]!.datasetId,
                    onChange: () => undefined
                  }}
                  onChange={(config) => {
                    if (configLocked || !multiDetails) return
                    const before = multiDetails[0]!.config as TrainingConfig
                    const nextConfigs = applySharedTrainingConfigChange(
                      multiDetails.map((d) => d.config as TrainingConfig),
                      before,
                      config
                    )
                    setMultiDetails(
                      multiDetails.map((d, i) => ({
                        ...d,
                        config: nextConfigs[i]!,
                        name: nextConfigs[i]!.name
                      }))
                    )
                  }}
                />
              </div>
            </>
          )
        ) : !detail ? (
          <div className="empty">Select or create a job.</div>
        ) : (
          <>
            <div className="jobs-detail-header">
              <div className="toolbar">
                <button
                  type="button"
                  className="primary"
                  disabled={configLocked}
                  title={configLocked ? 'Stop training before enqueueing changes' : undefined}
                  onClick={() => void enqueue()}
                >
                  Enqueue
                </button>
                <button
                  type="button"
                  disabled={configLocked || datasetHasOpenJob(jobs, detail.datasetId)}
                  title={
                    configLocked
                      ? 'Stop training before duplicating'
                      : datasetHasOpenJob(jobs, detail.datasetId)
                        ? 'This dataset already has a job — archive it first'
                        : 'Duplicate this job’s config as a new draft for the same dataset'
                  }
                  onClick={() => {
                    void (async () => {
                      await flushSave()
                      const dup = unwrap(
                        await window.loraTraining.jobs.duplicate(detail.id)
                      ) as { id: string }
                      changeFilter('new')
                      setSelectedIds([dup.id])
                      setSelectionAnchorId(dup.id)
                      await loadJob(dup.id)
                      void useAppStore.getState().refreshJobs()
                    })()
                  }}
                >
                  Duplicate
                </button>
                {detail.archived ? (
                  <button
                    type="button"
                    disabled={configLocked}
                    onClick={() => void setArchived(false)}
                  >
                    Unarchive
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={configLocked}
                    onClick={() => void setArchived(true)}
                  >
                    Archive
                  </button>
                )}
                <button
                  type="button"
                  className="danger"
                  disabled={configLocked}
                  title={configLocked ? 'Stop training before deleting this job' : undefined}
                  onClick={() => {
                    void (async () => {
                      const ok = await ask({
                        title: 'Delete job?',
                        message: `Delete job for “${labelForJob(detail)}”? Dataset and LoRA outputs are kept.`,
                        confirmLabel: 'Delete',
                        danger: true
                      })
                      if (!ok) return
                      if (saveTimer.current) {
                        clearTimeout(saveTimer.current)
                        saveTimer.current = null
                      }
                      saveGen.current += 1
                      unwrap(await window.loraTraining.jobs.remove(detail.id))
                      setSelectedIds([])
                      setSelectionAnchorId(null)
                      useAppStore.setState((s) => ({
                        selectedJobId: null,
                        jobDetail: null,
                        jobs: s.jobs.filter((j) => j.id !== detail.id),
                        queue: s.queue
                          ? {
                              ...s.queue,
                              jobIds: s.queue.jobIds.filter((id) => id !== detail.id),
                              statuses: Object.fromEntries(
                                Object.entries(s.queue.statuses).filter(([id]) => id !== detail.id)
                              ),
                              totalSteps: Object.fromEntries(
                                Object.entries(s.queue.totalSteps ?? {}).filter(
                                  ([id]) => id !== detail.id
                                )
                              ),
                              runningJobId:
                                s.queue.runningJobId === detail.id ? null : s.queue.runningJobId
                            }
                          : s.queue
                      }))
                      void useAppStore.getState().refreshJobs()
                    })()
                  }}
                >
                  Delete
                </button>
              </div>
              <span className="jobs-save-status" aria-live="polite">
                {configLocked ? 'Read-only' : saveStatus === 'saving' ? 'Saving…' : 'Saved'}
              </span>
            </div>
            <h2 className="jobs-detail-title">
              <JobBreadcrumb
                categoryName={partsForJob(detail).categoryName}
                datasetName={partsForJob(detail).datasetName}
              />
            </h2>
            {configLocked ? (
              <p className="hint jobs-running-lock" role="status">
                This job is training — settings are read-only. Stop it from the Queue tab to edit.
              </p>
            ) : identityLocked ? (
              <p className="hint jobs-running-lock" role="status">
                This job already has checkpoint output — LoRA name, dataset, trigger, resolution,
                dtype, and network are locked. Steps and other train settings stay editable until it
                is running. Checkpoint and VRAM options are in Settings → Training model.
              </p>
            ) : null}
            <div style={{ marginTop: '0.75rem' }}>
              <ConfigForm
                disabled={configLocked}
                lockIdentityFields={identityLocked}
                value={detail.config as TrainingConfig}
                onSuggestLoraName={
                  configLocked || identityLocked
                    ? undefined
                    : async () => {
                        const ds = datasets.find((d) => d.id === detail.datasetId)
                        if (!ds) return
                        const categoryName = categoryNameById.get(ds.categoryId) ?? ''
                        let checkpointFileNames: string[] = []
                        try {
                          const outs = unwrap(
                            await window.loraTraining.datasets.listOutputs(ds.id)
                          ) as { checkpoints: Array<{ fileName: string }> }
                          checkpointFileNames = outs.checkpoints.map((c) => c.fileName)
                        } catch {
                          /* no outputs yet — use Category_Dataset */
                        }
                        const suggested = suggestLoraName({
                          categoryName,
                          datasetName: ds.name,
                          checkpointFileNames
                        })
                        const current = useAppStore.getState().jobDetail
                        if (!current || current.id !== detail.id) return
                        const cfg = current.config as TrainingConfig
                        useAppStore.setState({
                          jobDetail: {
                            ...current,
                            name: suggested,
                            config: { ...cfg, name: suggested }
                          }
                        })
                      }
                }
                onChange={(config) => {
                  if (configLocked) return
                  const ds = datasets.find((d) => d.id === detail.datasetId)
                  const prev = detail.config as TrainingConfig
                  let next = ds
                    ? {
                        ...config,
                        training_folder: datasetOutputFolder(ds.folderPath),
                        datasets: config.datasets.map((row, i) =>
                          i === 0 ? { ...row, folder_path: ds.folderPath } : row
                        )
                      }
                    : config
                  // Preserve locked identity fields if the form somehow emits them.
                  if (identityLocked) {
                    next = {
                      ...next,
                      name: prev.name,
                      trigger_word: prev.trigger_word,
                      device: prev.device,
                      network: prev.network,
                      model: prev.model,
                      save: { ...next.save, dtype: prev.save.dtype },
                      train: {
                        ...next.train,
                        dtype: prev.train.dtype,
                        cache_text_embeddings: prev.train.cache_text_embeddings
                      },
                      datasets: next.datasets.map((row, i) => {
                        const old = prev.datasets[i]
                        if (!old) return row
                        return {
                          ...row,
                          folder_path: old.folder_path,
                          resolution: old.resolution,
                          caption_dropout_rate: old.caption_dropout_rate,
                          cache_latents_to_disk: old.cache_latents_to_disk,
                          shuffle_tokens: old.shuffle_tokens
                        }
                      })
                    }
                  }
                  useAppStore.setState({
                    jobDetail: {
                      ...detail,
                      name: next.name,
                      config: next
                    }
                  })
                }}
                datasetSelect={{
                  options: jobDatasetOptions,
                  value: detail.datasetId,
                  onChange: (datasetId) => {
                    if (configLocked || identityLocked) return
                    const ds = datasets.find((d) => d.id === datasetId)
                    if (!ds) return
                    const prev = detail.config as TrainingConfig
                    const datasetsCfg = [...prev.datasets]
                    if (datasetsCfg[0]) {
                      datasetsCfg[0] = {
                        ...datasetsCfg[0],
                        folder_path: ds.folderPath
                      }
                    }
                    const categoryName = categoryNameById.get(ds.categoryId) ?? ''
                    const baseConfig: TrainingConfig = {
                      ...prev,
                      datasets: datasetsCfg,
                      training_folder: datasetOutputFolder(ds.folderPath),
                      trigger_word: ds.trigger?.trim()
                        ? ds.trigger
                        : prev.trigger_word
                    }
                    // Optimistic paths/trigger; LoRA name filled after listOutputs.
                    const provisional = suggestLoraName({
                      categoryName,
                      datasetName: ds.name,
                      checkpointFileNames: []
                    })
                    useAppStore.setState({
                      jobDetail: {
                        ...detail,
                        datasetId,
                        name: provisional,
                        config: { ...baseConfig, name: provisional }
                      }
                    })
                    void window.loraTraining.datasets
                      .listOutputs(datasetId)
                      .then((r) => {
                        const outs = unwrap(r) as {
                          checkpoints: Array<{ fileName: string }>
                        }
                        const suggested = suggestLoraName({
                          categoryName,
                          datasetName: ds.name,
                          checkpointFileNames: outs.checkpoints.map((c) => c.fileName)
                        })
                        const current = useAppStore.getState().jobDetail
                        if (!current || current.datasetId !== datasetId) return
                        const cfg = current.config as TrainingConfig
                        useAppStore.setState({
                          jobDetail: {
                            ...current,
                            name: suggested,
                            config: { ...cfg, name: suggested }
                          }
                        })
                      })
                      .catch(() => undefined)
                  }
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
