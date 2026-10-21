import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, CircleDashed, RefreshCw, SpellCheck } from 'lucide-react'
import type {
  CategorySummary,
  DatasetLifecycleStatus,
  DatasetSummary,
  JobSummary
} from '@shared/ipc/contract'
import type {
  CaptionValidationIssue,
  CaptionValidationReport
} from '@shared/caption-validation'
import { patchReportAfterJpgConvert } from '@shared/caption-validation'
import { datasetHasQueuedJob } from '@shared/dataset-jobs'
import { groupDatasetsByCategory } from '@shared/dataset-groups'
import {
  explorerStatus,
  matchesStatusFilter,
  type DatasetStatusFilter
} from '@shared/explorer-status'
import { matchesExplorerName, parseExplorerNameQuery } from '@shared/explorer-search'
import {
  DATASET_IMAGE_DRAG_MIME,
  isDatasetImageDrag,
  parseDatasetImageDragPayload
} from '@shared/dataset-image-drag'
import { isTypingTarget } from '@shared/keyboard'
import { CaptionValidationResults } from './CaptionValidationResults'
import { DatasetStatusIcon } from './DatasetStatusIcon'
import { datasetThumbUrl } from '../media-url'
import { unwrap, useAppStore } from '../store'
import { useClampedMenuPosition } from '../util/contextMenuPosition'

export type { DatasetStatusFilter }
export { explorerStatus }

const FILTERS: Array<{ id: DatasetStatusFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'none', label: 'Not ready' },
  { id: 'ready', label: 'Ready' },
  { id: 'queued', label: 'Queue' },
  { id: 'trained', label: 'Trained' },
  { id: 'validated', label: 'Validated' },
  { id: 'done', label: 'Done' }
]

const COLLAPSED_KEY = 'lora-training:explorer-collapsed-categories'

type ContextMenuState = { x: number; y: number; dataset: DatasetSummary }

function readCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, boolean> = {}
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'boolean') out[id] = value
    }
    return out
  } catch {
    return {}
  }
}

function writeCollapsed(collapsed: Record<string, boolean>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed))
  } catch {
    /* ignore */
  }
}

export function DatasetExplorer(props: {
  categories: CategorySummary[]
  datasets: DatasetSummary[]
  jobs: JobSummary[]
  selectedId: string | null
  onSelect: (id: string) => void
  onRename: (dataset: DatasetSummary) => void
  onDuplicate: (dataset: DatasetSummary) => void
  onRemove: (dataset: DatasetSummary) => void
  onDeleteForever: (dataset: DatasetSummary) => void
  onReveal: (dataset: DatasetSummary) => void
  /** Open JoyCaption / add to caption queue for this dataset. */
  onCaptionQueue?: (dataset: DatasetSummary) => void
  /** Hide queue filter/badges while AI Toolkit training UI is unavailable. */
  showQueueStatus?: boolean
  /** Re-scan category folders (picks up external renames/add/remove). */
  onRefresh: () => void | Promise<void>
  refreshing?: boolean
  /** Initial / in-flight library list — avoid “No categories yet” flash. */
  libraryLoading?: boolean
  /** Live discovery/enrich progress (status bar + empty-state text). */
  libraryLoadProgress?: import('@shared/library-load-progress').LibraryLoadProgress | null
}): React.JSX.Element {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed)
  const [nameQuery, setNameQuery] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [validationBusy, setValidationBusy] = useState(false)
  const [validationFixing, setValidationFixing] = useState(false)
  const [validationOpen, setValidationOpen] = useState(false)
  const [validationReport, setValidationReport] = useState<CaptionValidationReport | null>(
    null
  )
  const { menuRef, menuStyle } = useClampedMenuPosition(
    contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null
  )
  const statusFilter = useAppStore((s) => s.explorerStatusFilter)
  const setExplorerStatusFilter = useAppStore((s) => s.setExplorerStatusFilter)
  const setStatus = useAppStore((s) => s.setStatus)
  const setError = useAppStore((s) => s.setError)
  const refreshAll = useAppStore((s) => s.refreshAll)
  const loadDataset = useAppStore((s) => s.loadDataset)
  const selectedDatasetId = useAppStore((s) => s.selectedDatasetId)

  async function runCaptionValidation(): Promise<void> {
    if (validationBusy || validationFixing) return
    setValidationBusy(true)
    setValidationOpen(true)
    setStatus('Validating captions…')
    try {
      const report = unwrap(
        await window.loraTraining.captions.validateReady()
      ) as CaptionValidationReport
      setValidationReport(report)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setValidationBusy(false)
    }
  }

  async function fixBadExtensionIssues(issues: CaptionValidationIssue[]): Promise<void> {
    if (validationBusy || validationFixing) return
    const targets = issues.filter(
      (i): i is CaptionValidationIssue & { fileName: string } =>
        i.kind === 'bad-extension' && Boolean(i.fileName)
    )
    if (targets.length === 0) return

    const byDataset = new Map<string, string[]>()
    for (const issue of targets) {
      const list = byDataset.get(issue.datasetId) ?? []
      list.push(issue.fileName)
      byDataset.set(issue.datasetId, list)
    }

    setValidationFixing(true)
    setStatus(
      targets.length === 1
        ? `Converting ${targets[0]!.fileName} to JPG…`
        : `Converting ${targets.length} images to JPG…`
    )
    try {
      let changed = 0
      for (const [datasetId, fileNames] of byDataset) {
        const result = unwrap(
          await window.loraTraining.datasets.convertImagesToJpg(datasetId, false, fileNames)
        ) as { changed: number }
        changed += result.changed
        setValidationReport((prev) =>
          prev ? patchReportAfterJpgConvert(prev, datasetId, fileNames) : prev
        )
        if (selectedDatasetId === datasetId) await loadDataset(datasetId)
      }
      await refreshAll()
      setStatus(
        changed > 0
          ? `Converted ${changed} image${changed === 1 ? '' : 's'} to JPG`
          : 'No images needed conversion'
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setValidationFixing(false)
    }
  }

  async function openValidationIssue(issue: CaptionValidationIssue): Promise<void> {
    try {
      await loadDataset(issue.datasetId)
      useAppStore.setState({
        datasetsMiddleTab: 'images',
        selectedImage: issue.fileName,
        selectedImages: issue.fileName ? [issue.fileName] : []
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const validationResults = (
    <CaptionValidationResults
      open={validationOpen}
      busy={validationBusy}
      fixing={validationFixing}
      report={validationReport}
      onClose={() => setValidationOpen(false)}
      onValidate={() => void runCaptionValidation()}
      onOpenIssue={(issue) => void openValidationIssue(issue)}
      onFixBadExtensions={(issues) => void fixBadExtensionIssues(issues)}
    />
  )

  async function acceptImageDrop(
    target: DatasetSummary,
    e: React.DragEvent
  ): Promise<void> {
    e.preventDefault()
    e.stopPropagation()
    setDropTargetId(null)
    if (!isDatasetImageDrag(e.dataTransfer.types)) return
    const raw = e.dataTransfer.getData(DATASET_IMAGE_DRAG_MIME)
    const payload = parseDatasetImageDragPayload(raw)
    if (!payload) return
    if (payload.sourceDatasetId === target.id) {
      setStatus('Drop on a different dataset to move or copy')
      return
    }
    const mode: 'copy' | 'move' = e.shiftKey ? 'copy' : 'move'
    try {
      const result = unwrap(
        await window.loraTraining.datasets.transferImages({
          sourceDatasetId: payload.sourceDatasetId,
          targetDatasetId: target.id,
          fileNames: payload.fileNames,
          mode
        })
      ) as { transferred: number; skipped: number; mode: 'copy' | 'move' }
      const verb = result.mode === 'copy' ? 'Copied' : 'Moved'
      setStatus(
        `${verb} ${result.transferred} image${result.transferred === 1 ? '' : 's'} → ${target.name}${
          result.skipped ? ` · ${result.skipped} skipped` : ''
        }`
      )
      await refreshAll()
      if (selectedDatasetId === payload.sourceDatasetId || selectedDatasetId === target.id) {
        if (selectedDatasetId) await loadDataset(selectedDatasetId)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function setAndPersistFilter(filter: DatasetStatusFilter): void {
    setExplorerStatusFilter(filter)
  }

  useEffect(() => {
    if (!contextMenu) return
    const close = (): void => setContextMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
    }
  }, [contextMenu])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'F2') return
      if (isTypingTarget(e.target)) return
      if (document.querySelector('.modal-backdrop')) return
      const ds =
        (contextMenu ? props.datasets.find((d) => d.id === contextMenu.dataset.id) : null) ??
        props.datasets.find((d) => d.id === props.selectedId)
      if (!ds) return
      e.preventDefault()
      setContextMenu(null)
      props.onRename(ds)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [contextMenu, props.datasets, props.onRename, props.selectedId])

  function toggleCollapsed(categoryId: string): void {
    setCollapsed((prev) => {
      const next = { ...prev, [categoryId]: !prev[categoryId] }
      writeCollapsed(next)
      return next
    })
  }

  const queuedJobByDataset = useMemo(() => {
    const set = new Set<string>()
    if (props.showQueueStatus === false) return set
    for (const ds of props.datasets) {
      if (datasetHasQueuedJob(props.jobs, ds.id)) set.add(ds.id)
    }
    return set
  }, [props.datasets, props.jobs, props.showQueueStatus])

  const nameSearch = useMemo(() => parseExplorerNameQuery(nameQuery), [nameQuery])
  const nameQueryActive = Boolean(nameSearch.needle)

  const categoryNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of props.categories) map.set(c.id, c.name)
    return map
  }, [props.categories])

  const filteredDatasets = useMemo(() => {
    return props.datasets.filter((ds) => {
      if (!matchesStatusFilter(ds, statusFilter, queuedJobByDataset.has(ds.id))) return false
      if (!nameSearch.needle) return true
      const catName = categoryNameById.get(ds.categoryId) ?? ''
      return (
        matchesExplorerName(ds.name, nameSearch.needle, nameSearch.wholeWord) ||
        matchesExplorerName(catName, nameSearch.needle, nameSearch.wholeWord)
      )
    })
  }, [
    props.datasets,
    statusFilter,
    queuedJobByDataset,
    nameSearch,
    categoryNameById
  ])

  const groups = useMemo(() => {
    const grouped = groupDatasetsByCategory(props.categories, filteredDatasets)
    if (!nameQueryActive) {
      // All: keep empty folder-backed categories. Other tabs are filters — hide empties.
      if (statusFilter === 'all') return grouped
      return grouped.filter((g) => g.datasets.length > 0)
    }
    // Search: keep categories whose name matches (even if empty after status filter),
    // or that still have at least one matching dataset.
    return grouped.filter(
      (g) =>
        matchesExplorerName(g.category.name, nameSearch.needle, nameSearch.wholeWord) ||
        g.datasets.length > 0
    )
  }, [props.categories, filteredDatasets, statusFilter, nameQueryActive, nameSearch])

  const filterBar = (
    <div className="explorer-filter-stack">
      <div className="explorer-filter" role="toolbar" aria-label="Filter by status">
        {FILTERS.filter((f) => f.id !== 'queued' || props.showQueueStatus !== false).map((f) => (
          <button
            key={f.id}
            type="button"
            className={`explorer-filter-btn${f.id === 'all' ? '' : ' explorer-filter-btn-icon'}${
              statusFilter === f.id ? ' active' : ''
            }`}
            title={f.id === 'all' ? undefined : f.label}
            aria-label={f.label}
            onClick={() => setAndPersistFilter(f.id)}
          >
            {f.id === 'all' ? (
              f.label
            ) : f.id === 'none' ? (
              <CircleDashed
                className="explorer-filter-icon"
                size={14}
                strokeWidth={2.25}
                aria-hidden="true"
              />
            ) : (
              <DatasetStatusIcon
                status={f.id as DatasetLifecycleStatus}
                className="explorer-filter-icon"
              />
            )}
          </button>
        ))}
        <button
          type="button"
          className="icon-btn explorer-validate-btn"
          title="Caption validation — opens last results; Validate inside to re-check"
          aria-label="Caption validation"
          disabled={validationBusy || validationFixing}
          onClick={() => setValidationOpen(true)}
        >
          <SpellCheck size={14} strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-btn explorer-refresh-btn"
          title="Refresh library — re-scan category folders for renames, adds, and removals"
          aria-label="Refresh library"
          disabled={props.refreshing}
          onClick={() => void props.onRefresh()}
        >
          <RefreshCw
            size={14}
            strokeWidth={2}
            aria-hidden="true"
            className={props.refreshing ? 'spin' : undefined}
          />
        </button>
      </div>
      <label className="explorer-search">
        <span className="sr-only">Search categories and datasets</span>
        <input
          type="search"
          value={nameQuery}
          onChange={(e) => setNameQuery(e.target.value)}
          placeholder="Search…"
          title={'Filter categories & datasets ("word" = whole word)'}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
    </div>
  )

  const menu =
    contextMenu != null ? (
      <div
        ref={menuRef}
        className="context-menu"
        style={menuStyle}
        role="menu"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          role="menuitem"
          className="context-menu-item"
          onClick={() => {
            const ds = contextMenu.dataset
            setContextMenu(null)
            props.onRename(ds)
          }}
        >
          Rename
          <span className="context-menu-shortcut">F2</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="context-menu-item"
          onClick={() => {
            const ds = contextMenu.dataset
            setContextMenu(null)
            props.onDuplicate(ds)
          }}
        >
          Duplicate…
        </button>
        <button
          type="button"
          role="menuitem"
          className="context-menu-item"
          onClick={() => {
            const ds = contextMenu.dataset
            setContextMenu(null)
            props.onReveal(ds)
          }}
        >
          Reveal in Explorer
        </button>
        {props.onCaptionQueue ? (
          <button
            type="button"
            role="menuitem"
            className="context-menu-item"
            onClick={() => {
              const ds = contextMenu.dataset
              setContextMenu(null)
              props.onCaptionQueue?.(ds)
            }}
          >
            Add to caption queue…
          </button>
        ) : null}
        {(() => {
          const cat = props.categories.find((c) => c.id === contextMenu.dataset.categoryId)
          if (cat?.folderPath?.trim()) return null
          return (
            <button
              type="button"
              role="menuitem"
              className="context-menu-item danger"
              onClick={() => {
                const ds = contextMenu.dataset
                setContextMenu(null)
                props.onRemove(ds)
              }}
            >
              Remove from library
            </button>
          )
        })()}
        <button
          type="button"
          role="menuitem"
          className="context-menu-item danger"
          onClick={() => {
            const ds = contextMenu.dataset
            setContextMenu(null)
            props.onDeleteForever(ds)
          }}
        >
          Delete dataset…
        </button>
      </div>
    ) : null

  if (props.categories.length === 0 && props.datasets.length === 0) {
    return (
      <div className="explorer">
        {filterBar}
        <div className="explorer-body">
          <div className="empty">
            {props.libraryLoading
              ? props.libraryLoadProgress?.message
                ? props.libraryLoadProgress.total > 0
                  ? `${props.libraryLoadProgress.message} (${props.libraryLoadProgress.done}/${props.libraryLoadProgress.total})`
                  : props.libraryLoadProgress.message
                : 'Loading library…'
              : 'No categories yet. Open Categories to create one, then add a dataset.'}
          </div>
        </div>
        {menu}
        {validationResults}
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div className="explorer">
        {filterBar}
        <div className="explorer-body">
          <div className="empty">
            {nameQueryActive
              ? 'No categories or datasets match this search.'
              : props.datasets.length > 0 && filteredDatasets.length === 0
                ? 'No datasets match this filter.'
                : 'No datasets. Add an image folder to a category.'}
          </div>
        </div>
        {menu}
        {validationResults}
      </div>
    )
  }

  return (
    <div className="explorer">
      {filterBar}
      <div className="explorer-body">
        {groups.map(({ category, datasets }) => {
          const isCollapsed =
            Boolean(collapsed[category.id]) && !nameQueryActive
          return (
            <div key={category.id} className="explorer-group">
              <button
                type="button"
                className="explorer-group-header"
                onClick={() => toggleCollapsed(category.id)}
              >
                <span className="explorer-chevron" aria-hidden="true">
                  {isCollapsed ? (
                    <ChevronRight size={14} strokeWidth={2} />
                  ) : (
                    <ChevronDown size={14} strokeWidth={2} />
                  )}
                </span>
                <span>{category.name}</span>
                <span className="explorer-count">{datasets.length}</span>
              </button>
              {!isCollapsed &&
                (datasets.length === 0 ? (
                  <div className="hint explorer-empty-cat">
                    {props.libraryLoading
                      ? props.libraryLoadProgress?.message
                        ? props.libraryLoadProgress.total > 0
                          ? `${props.libraryLoadProgress.message} (${props.libraryLoadProgress.done}/${props.libraryLoadProgress.total})`
                          : props.libraryLoadProgress.message
                        : 'Discovering datasets…'
                      : 'No datasets in this folder yet. Add a subfolder with JPG/PNG images.'}
                  </div>
                ) : (
                  <div className="explorer-grid">
                    {datasets.map((ds) => (
                      <DatasetTile
                        key={ds.id}
                        dataset={ds}
                        status={explorerStatus(ds, queuedJobByDataset.has(ds.id))}
                        active={props.selectedId === ds.id}
                        dropActive={dropTargetId === ds.id}
                        onSelect={props.onSelect}
                        onContextMenu={(dataset, e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          props.onSelect(dataset.id)
                          setContextMenu({ x: e.clientX, y: e.clientY, dataset })
                        }}
                        onDragOver={(e) => {
                          if (!isDatasetImageDrag(e.dataTransfer.types)) return
                          e.preventDefault()
                          e.stopPropagation()
                          e.dataTransfer.dropEffect = e.shiftKey ? 'copy' : 'move'
                          if (dropTargetId !== ds.id) setDropTargetId(ds.id)
                        }}
                        onDragLeave={(e) => {
                          if (e.currentTarget.contains(e.relatedTarget as Node)) return
                          if (dropTargetId === ds.id) setDropTargetId(null)
                        }}
                        onDrop={(e) => void acceptImageDrop(ds, e)}
                      />
                    ))}
                  </div>
                ))}
            </div>
          )
        })}
      </div>
      {menu}
      {validationResults}
    </div>
  )
}

function DatasetTile(props: {
  dataset: DatasetSummary
  status: DatasetLifecycleStatus
  active: boolean
  dropActive?: boolean
  onSelect: (id: string) => void
  onContextMenu: (dataset: DatasetSummary, e: React.MouseEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
}): React.JSX.Element {
  const cover = props.dataset.coverFileName
    ? datasetThumbUrl(props.dataset.id, props.dataset.coverFileName, props.dataset.updatedAt)
    : null

  const statusHint =
    props.status === 'done'
      ? 'Done'
      : props.status === 'validated'
        ? 'Validated'
        : props.status === 'trained'
          ? 'Trained'
          : props.status === 'queued'
            ? 'In training queue'
            : props.status === 'ready'
              ? 'Ready'
              : 'New'

  return (
    <button
      type="button"
      className={`explorer-tile${props.active ? ' active' : ''}${
        props.dropActive ? ' drop-target' : ''
      }`}
      title={`${props.dataset.name}\n${props.dataset.folderPath}\n${props.dataset.stats.images} images · ${statusHint}\nDrop image here to move · Shift+drop to copy`}
      onClick={() => props.onSelect(props.dataset.id)}
      onContextMenu={(e) => props.onContextMenu(props.dataset, e)}
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
      onDrop={props.onDrop}
    >
      <div className="explorer-thumb">
        {cover ? (
          <img src={cover} alt="" loading="lazy" draggable={false} />
        ) : (
          <div className="explorer-thumb-empty">{props.dataset.stats.images || 0}</div>
        )}
        <DatasetStatusIcon status={props.status} className="explorer-status" />
      </div>
      <div className="explorer-tile-label">{props.dataset.name}</div>
    </button>
  )
}
