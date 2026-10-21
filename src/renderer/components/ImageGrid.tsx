import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ImageUpscale } from 'lucide-react'
import type { DatasetDetail, ImageEntry } from '@shared/ipc/contract'
import {
  cellSizeForWidth,
  columnCountForWidth,
  nextIndexForArrow
} from '@shared/image-grid-nav'
import {
  DATASET_IMAGE_DRAG_MIME,
  encodeDatasetImageDragPayload
} from '@shared/dataset-image-drag'
import { rangeIdsInclusive } from '@shared/queue-selection'
import { toolConfigFlags } from '@shared/tool-config'
import { ImagePreviewOverlay } from './ImagePreviewOverlay'
import { datasetThumbUrl } from '../media-url'
import { unwrap, useAppStore } from '../store'
import { useClampedMenuPosition } from '../util/contextMenuPosition'

const MIN_COL_WIDTH = 112
const GRID_GAP = 8
/** Matches `.image-grid-nav` horizontal padding (4px × 2). */
const GRID_PAD_X = 8

type ContextMenuState = { x: number; y: number; fileName: string }

function contentWidth(el: HTMLElement): number {
  return Math.max(0, el.clientWidth - GRID_PAD_X)
}

export function ImageGrid(props: {
  datasetId: string
  images: ImageEntry[]
  selected: string | null
  onSelect: (fileName: string) => void
  /** Image currently being captioned (shows processing border). */
  processingFileName?: string | null
  /** Open “Create dataset from image” for this file. */
  onCreateDatasetFromImage?: (fileName: string) => void
}): React.JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [previewFile, setPreviewFile] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const { menuRef, menuStyle } = useClampedMenuPosition(
    contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null
  )
  const [mediaBust, setMediaBust] = useState(() => Date.now())
  const [dragOver, setDragOver] = useState(false)
  const selectedIds = useAppStore((s) => s.selectedImages)
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(
    () => props.selected
  )
  const suppressClickAfterDrag = useRef(false)
  const refreshThumbsAfterEdit = useRef(false)
  const setStatus = useAppStore((s) => s.setStatus)
  const setError = useAppStore((s) => s.setError)
  const refreshAll = useAppStore((s) => s.refreshAll)
  const loadDataset = useAppStore((s) => s.loadDataset)
  const settings = useAppStore((s) => s.settings)
  const toolFlags = useMemo(() => toolConfigFlags(settings), [settings])

  const orderedIds = useMemo(
    () => props.images.map((img) => img.fileName),
    [props.images]
  )
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const multiSelected = selectedIds.length > 1

  const columns = useMemo(
    () => columnCountForWidth(containerWidth || MIN_COL_WIDTH, MIN_COL_WIDTH, GRID_GAP),
    [containerWidth]
  )
  const cellSize = useMemo(
    () => cellSizeForWidth(containerWidth || MIN_COL_WIDTH, columns, GRID_GAP),
    [containerWidth, columns]
  )
  /** Square cell + inter-row gap (matches virtual row `paddingBottom`). */
  const rowSize = cellSize + GRID_GAP

  useEffect(() => {
    setSelectionAnchor(props.selected)
    setPreviewFile(null)
    setContextMenu(null)
  }, [props.datasetId])

  // Tip ADS edits leave $DATA mtime unchanged — bust when version fingerprints change.
  const versionFingerprint = useMemo(
    () => props.images.map((img) => `${img.fileName}:${img.versionCount}`).join('|'),
    [props.images]
  )
  useEffect(() => {
    setMediaBust(Date.now())
  }, [props.datasetId, versionFingerprint])

  useEffect(() => {
    setSelectionAnchor((anchor) => {
      if (anchor && selectedSet.has(anchor)) return anchor
      return props.selected
    })
  }, [orderedIds, props.selected, selectedSet])

  useEffect(() => {
    const refresh = (): void => {
      if (!refreshThumbsAfterEdit.current) return
      refreshThumbsAfterEdit.current = false
      setMediaBust(Date.now())
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  useEffect(() => {
    const el = parentRef.current
    if (!el) return
    const update = (): void => {
      setContainerWidth(contentWidth(el))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [props.images.length])

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

  const selectedIndex = props.selected
    ? props.images.findIndex((img) => img.fileName === props.selected)
    : -1

  const applySelection = useCallback(
    (ids: string[], focus: string | null, anchor: string | null) => {
      setSelectionAnchor(anchor)
      useAppStore.setState({
        selectedImage: focus,
        selectedImages: ids
      })
    },
    []
  )

  const selectImage = useCallback(
    (fileName: string, e: React.MouseEvent) => {
      if (suppressClickAfterDrag.current) {
        suppressClickAfterDrag.current = false
        return
      }
      const additive = e.ctrlKey || e.metaKey
      const range = e.shiftKey

      if (range && selectionAnchor) {
        const span = rangeIdsInclusive(orderedIds, selectionAnchor, fileName)
        if (additive) {
          const next = new Set(selectedIds)
          for (const id of span) next.add(id)
          applySelection(
            orderedIds.filter((id) => next.has(id)),
            fileName,
            selectionAnchor
          )
        } else {
          applySelection(span, fileName, selectionAnchor)
        }
        return
      }

      if (additive) {
        const next = new Set(selectedIds)
        if (next.has(fileName)) next.delete(fileName)
        else next.add(fileName)
        const ids = orderedIds.filter((id) => next.has(id))
        const focus =
          ids.length === 0
            ? null
            : ids.includes(fileName)
              ? fileName
              : (ids[ids.length - 1] ?? null)
        applySelection(ids, focus, fileName)
        return
      }

      applySelection([fileName], fileName, fileName)
    },
    [applySelection, orderedIds, selectedIds, selectionAnchor]
  )

  const selectIndex = useCallback(
    (index: number) => {
      const img = props.images[index]
      if (!img) return
      applySelection([img.fileName], img.fileName, img.fileName)
      requestAnimationFrame(() => {
        const active = parentRef.current?.querySelector('.thumb.active') as HTMLElement | null
        active?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      })
    },
    [applySelection, props.images]
  )

  const performDelete = useCallback(
    async (fileName: string, permanent: boolean) => {
      try {
        const idx = props.images.findIndex((img) => img.fileName === fileName)
        const result = unwrap(
          await window.loraTraining.datasets.deleteImage(props.datasetId, fileName, {
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
        const prev = useAppStore.getState().datasetDetail
        if (!prev || prev.id !== props.datasetId) return
        const deleteIdx =
          idx >= 0 ? idx : prev.images.findIndex((img) => img.fileName === result.fileName)
        const images = prev.images.filter((img) => img.fileName !== result.fileName)
        const nextSelected =
          deleteIdx < 0
            ? (images[0]?.fileName ?? null)
            : (images[deleteIdx]?.fileName ?? images[deleteIdx - 1]?.fileName ?? null)
        const selected = useAppStore.getState().selectedImage
        const selectedStillThere =
          selected != null && images.some((img) => img.fileName === selected)
        const focus = selectedStillThere ? selected : nextSelected
        const datasets = useAppStore.getState().datasets
        useAppStore.setState({
          datasetDetail: {
            ...prev,
            images,
            coverFileName: result.coverFileName,
            stats: result.stats,
            updatedAt: result.updatedAt
          },
          selectedImage: focus,
          selectedImages: focus ? [focus] : [],
          datasets: datasets.map((d) =>
            d.id === prev.id
              ? {
                  ...d,
                  stats: result.stats,
                  coverFileName: result.coverFileName,
                  updatedAt: result.updatedAt
                }
              : d
          )
        })
        setSelectionAnchor(focus)
        setPreviewFile((prevPreview) =>
          prevPreview === fileName ? nextSelected : prevPreview
        )
        setStatus(
          result.permanent
            ? `Permanently deleted ${fileName}`
            : `Moved ${fileName} to Recycle Bin`
        )
        requestAnimationFrame(() => {
          const root = parentRef.current
          root?.focus()
          const active = root?.querySelector('.thumb.active') as HTMLElement | null
          active?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [props.datasetId, props.images, setError, setStatus]
  )

  const performDeleteMany = useCallback(
    async (fileNames: string[], permanent: boolean) => {
      const unique = orderedIds.filter((id) => fileNames.includes(id))
      if (unique.length === 0) return
      if (unique.length === 1) {
        await performDelete(unique[0]!, permanent)
        return
      }
      try {
        let deleted = 0
        for (const fileName of unique) {
          unwrap(
            await window.loraTraining.datasets.deleteImage(props.datasetId, fileName, {
              permanent
            })
          )
          deleted++
        }
        await loadDataset(props.datasetId)
        await refreshAll()
        setPreviewFile(null)
        setStatus(
          permanent
            ? `Permanently deleted ${deleted} image${deleted === 1 ? '' : 's'}`
            : `Moved ${deleted} image${deleted === 1 ? '' : 's'} to Recycle Bin`
        )
        requestAnimationFrame(() => parentRef.current?.focus())
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        try {
          await loadDataset(props.datasetId)
          await refreshAll()
        } catch {
          /* ignore follow-up */
        }
      }
    },
    [
      loadDataset,
      orderedIds,
      performDelete,
      props.datasetId,
      refreshAll,
      setError,
      setStatus
    ]
  )

  const trashImages = useCallback(
    async (fileNames: string[]) => {
      setContextMenu(null)
      await performDeleteMany(fileNames, false)
    },
    [performDeleteMany]
  )

  const deleteImagesPermanent = useCallback(
    async (fileNames: string[]) => {
      setContextMenu(null)
      await performDeleteMany(fileNames, true)
    },
    [performDeleteMany]
  )

  const openPreview = useCallback(
    (fileName: string) => {
      applySelection([fileName], fileName, fileName)
      setPreviewFile(fileName)
    },
    [applySelection]
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        if (props.images.length === 0 || previewFile) return
        e.preventDefault()
        e.stopPropagation()
        const first = orderedIds[0] ?? null
        const last = orderedIds[orderedIds.length - 1] ?? first
        applySelection(orderedIds, props.selected ?? last, first)
        return
      }
      if (e.key === 'Enter') {
        if (props.images.length === 0 || previewFile || !props.selected) return
        e.preventDefault()
        e.stopPropagation()
        openPreview(props.selected)
        return
      }
      if (e.key === 'Delete') {
        if (props.images.length === 0 || previewFile || selectedIds.length === 0) return
        e.preventDefault()
        e.stopPropagation()
        const targets =
          selectedIds.length > 0
            ? selectedIds
            : props.selected
              ? [props.selected]
              : []
        if (targets.length === 0) return
        if (e.shiftKey) {
          void deleteImagesPermanent(targets)
        } else {
          void trashImages(targets)
        }
        return
      }
      if (
        e.key !== 'ArrowLeft' &&
        e.key !== 'ArrowRight' &&
        e.key !== 'ArrowUp' &&
        e.key !== 'ArrowDown'
      ) {
        return
      }
      if (props.images.length === 0 || previewFile) return
      e.preventDefault()
      e.stopPropagation()

      const current = selectedIndex >= 0 ? selectedIndex : 0
      const next = nextIndexForArrow(current, e.key, columns, props.images.length)
      selectIndex(next)
    },
    [
      applySelection,
      columns,
      deleteImagesPermanent,
      openPreview,
      orderedIds,
      previewFile,
      props.images.length,
      props.selected,
      selectIndex,
      selectedIds,
      selectedIndex,
      trashImages
    ]
  )

  const openContextMenu = useCallback(
    (fileName: string, e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!selectedSet.has(fileName)) {
        applySelection([fileName], fileName, fileName)
      } else if (props.selected !== fileName) {
        useAppStore.setState({ selectedImage: fileName })
      }
      setContextMenu({ x: e.clientX, y: e.clientY, fileName })
    },
    [applySelection, props.selected, selectedSet]
  )

  const editInPhotoshop = useCallback(
    async (fileName: string) => {
      setContextMenu(null)
      try {
        const result = unwrap(
          await window.loraTraining.tools.editInPhotoshop(props.datasetId, fileName)
        ) as { opened: boolean }
        if (result.opened) {
          refreshThumbsAfterEdit.current = true
          setStatus(`Opened ${fileName} in Photoshop`)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [props.datasetId, setError, setStatus]
  )

  const openImageEditor = useAppStore((s) => s.openImageEditor)
  const editInApp = useCallback(
    (fileName: string) => {
      setContextMenu(null)
      openImageEditor(props.datasetId, fileName)
    },
    [openImageEditor, props.datasetId]
  )

  const setAsCover = useCallback(
    async (fileName: string) => {
      setContextMenu(null)
      try {
        unwrap(
          await window.loraTraining.datasets.update({
            id: props.datasetId,
            coverFileName: fileName
          })
        )
        await refreshAll()
        setStatus(`Cover set to ${fileName}`)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [props.datasetId, refreshAll, setError, setStatus]
  )

  const revealInExplorer = useCallback(
    async (fileName: string) => {
      setContextMenu(null)
      try {
        unwrap(await window.loraTraining.datasets.revealImage(props.datasetId, fileName))
        setStatus(`Revealed ${fileName}`)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [props.datasetId, setError, setStatus]
  )

  const clearCaptions = useCallback(
    async (fileNames: string[]) => {
      setContextMenu(null)
      try {
        let cleared = 0
        for (const fileName of fileNames) {
          const result = unwrap(
            await window.loraTraining.captions.clear(props.datasetId, fileName)
          ) as { cleared: boolean }
          if (result.cleared) cleared++
        }
        await loadDataset(props.datasetId)
        await refreshAll()
        useAppStore.setState((s) => ({ captionReloadNonce: s.captionReloadNonce + 1 }))
        setStatus(
          cleared > 0
            ? `Cleared ${cleared} caption${cleared === 1 ? '' : 's'}`
            : 'No captions to clear'
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [loadDataset, props.datasetId, refreshAll, setError, setStatus]
  )

  const requestUpscale = useAppStore((s) => s.requestUpscale)
  const openUpscale = useCallback(
    (fileName: string) => {
      setContextMenu(null)
      void requestUpscale(props.datasetId, fileName)
    },
    [props.datasetId, requestUpscale]
  )

  const requestDiversify = useAppStore((s) => s.requestDiversify)
  const openDiversify = useCallback(
    (fileName: string, mode: 'context' | 'expression') => {
      setContextMenu(null)
      void requestDiversify(props.datasetId, fileName, mode)
    },
    [props.datasetId, requestDiversify]
  )

  const revertUpscale = useCallback(
    async (fileName: string) => {
      setContextMenu(null)
      try {
        unwrap(await window.loraTraining.imageEdit.revertOriginal(props.datasetId, fileName))
        setMediaBust(Date.now())
        setStatus(`Reverted to original · ${fileName}`)
        await loadDataset(props.datasetId, { preserveCaptionFlags: true })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [loadDataset, props.datasetId, setError, setStatus]
  )

  const undoLastEdit = useCallback(
    async (fileName: string) => {
      setContextMenu(null)
      try {
        unwrap(await window.loraTraining.imageEdit.undoLast(props.datasetId, fileName))
        setMediaBust(Date.now())
        setStatus(`Undid last edit · ${fileName}`)
        await loadDataset(props.datasetId, { preserveCaptionFlags: true })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [loadDataset, props.datasetId, setError, setStatus]
  )

  const contextTargets = useMemo(() => {
    if (!contextMenu) return [] as string[]
    if (multiSelected && selectedSet.has(contextMenu.fileName)) return selectedIds
    return [contextMenu.fileName]
  }, [contextMenu, multiSelected, selectedIds, selectedSet])

  const contextIsMulti = contextTargets.length > 1

  const contextImage = useMemo(() => {
    if (!contextMenu || contextIsMulti) return null
    return props.images.find((img) => img.fileName === contextMenu.fileName) ?? null
  }, [contextIsMulti, contextMenu, props.images])

  const contextHasAnyCaption = useMemo(() => {
    if (contextTargets.length === 0) return false
    const want = new Set(contextTargets)
    return props.images.some((img) => want.has(img.fileName) && img.captionExists)
  }, [contextTargets, props.images])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy'
      setDragOver(true)
    }
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
  }, [])

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragOver(false)
      const files = [...e.dataTransfer.files]
      if (files.length === 0) return
      const paths: string[] = []
      for (const file of files) {
        try {
          const p = window.loraTraining.system.pathForFile(file)
          if (p) paths.push(p)
        } catch {
          /* skip */
        }
      }
      if (paths.length === 0) {
        setError('Could not read dropped file paths')
        return
      }
      try {
        const result = unwrap(
          await window.loraTraining.datasets.importFiles(props.datasetId, paths)
        ) as { imported: number; skipped: number }
        await loadDataset(props.datasetId)
        await refreshAll()
        setMediaBust(Date.now())
        setStatus(
          `Imported ${result.imported} file${result.imported === 1 ? '' : 's'}${
            result.skipped ? ` · ${result.skipped} skipped` : ''
          }`
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [loadDataset, props.datasetId, refreshAll, setError, setStatus]
  )

  const dropProps = {
    onDragOver,
    onDragLeave,
    onDrop,
    'data-drag-over': dragOver ? 'true' : undefined
  }

  const rowCount = Math.max(1, Math.ceil(props.images.length / columns))
  const virtualizer = useVirtualizer({
    count: props.images.length === 0 ? 0 : rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowSize,
    /** A couple of rows above/below the viewport — not the whole dataset. */
    overscan: 2
  })

  useEffect(() => {
    virtualizer.measure()
  }, [rowSize, columns, rowCount, virtualizer])

  useEffect(() => {
    if (selectedIndex < 0) return
    const row = Math.floor(selectedIndex / columns)
    virtualizer.scrollToIndex(row, { align: 'auto' })
  }, [selectedIndex, columns, virtualizer])

  const preview =
    previewFile != null ? (
      <ImagePreviewOverlay
        datasetId={props.datasetId}
        fileName={previewFile}
        fileNames={props.images.map((img) => img.fileName)}
        onClose={() => setPreviewFile(null)}
        onNavigate={(fileName) => {
          applySelection([fileName], fileName, fileName)
          setPreviewFile(fileName)
        }}
        onDelete={(permanent) => {
          void (permanent
            ? deleteImagesPermanent([previewFile])
            : trashImages([previewFile]))
        }}
      />
    ) : null

  const menu =
    contextMenu != null ? (
      <div
        ref={menuRef}
        className="context-menu"
        style={menuStyle}
        role="menu"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {contextIsMulti ? (
          <>
            <button
              type="button"
              role="menuitem"
              className="context-menu-item"
              onClick={() => void revealInExplorer(contextTargets[0]!)}
            >
              Reveal in Explorer
            </button>
            {contextHasAnyCaption ? (
              <button
                type="button"
                role="menuitem"
                className="context-menu-item"
                title="Delete the .txt sidecars so these images are uncaptioned again"
                onClick={() => void clearCaptions(contextTargets)}
              >
                Clear captions
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              className="context-menu-item danger"
              onClick={() => void trashImages(contextTargets)}
            >
              Move to Recycle Bin
              <span className="hint" style={{ marginLeft: '0.5rem' }}>
                Del
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="context-menu-item danger"
              onClick={() => void deleteImagesPermanent(contextTargets)}
            >
              Delete permanently
              <span className="hint" style={{ marginLeft: '0.5rem' }}>
                Shift+Del
              </span>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              role="menuitem"
              className="context-menu-item"
              onClick={() => void setAsCover(contextMenu.fileName)}
            >
              Set Dataset Cover
            </button>
            <button
              type="button"
              role="menuitem"
              className="context-menu-item"
              onClick={() => void revealInExplorer(contextMenu.fileName)}
            >
              Reveal in Explorer
            </button>
            {toolFlags.comfy ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="context-menu-item"
                  onClick={() => openUpscale(contextMenu.fileName)}
                >
                  Upscale
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="context-menu-item"
                  onClick={() => openDiversify(contextMenu.fileName, 'context')}
                >
                  Diversify Context
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="context-menu-item"
                  onClick={() => openDiversify(contextMenu.fileName, 'expression')}
                >
                  Diversify Expression
                </button>
              </>
            ) : null}
            <button
              type="button"
              role="menuitem"
              className="context-menu-item"
              onClick={() => {
                setContextMenu(null)
                props.onCreateDatasetFromImage?.(contextMenu.fileName)
              }}
            >
              Create New Dataset…
            </button>
            {contextImage?.hasOriginal ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="context-menu-item"
                  onClick={() => void undoLastEdit(contextMenu.fileName)}
                >
                  Undo last edit
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="context-menu-item"
                  onClick={() => void revertUpscale(contextMenu.fileName)}
                >
                  Revert to original
                </button>
              </>
            ) : null}
            <button
              type="button"
              role="menuitem"
              className="context-menu-item"
              onClick={() => editInApp(contextMenu.fileName)}
            >
              Edit image…
            </button>
            <button
              type="button"
              role="menuitem"
              className="context-menu-item"
              onClick={() => void editInPhotoshop(contextMenu.fileName)}
            >
              Edit in Photoshop…
            </button>
            {contextImage?.captionExists ? (
              <button
                type="button"
                role="menuitem"
                className="context-menu-item"
                title="Delete the .txt sidecar so this image is uncaptioned again"
                onClick={() => void clearCaptions([contextMenu.fileName])}
              >
                Clear caption
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              className="context-menu-item danger"
              onClick={() => void trashImages([contextMenu.fileName])}
            >
              Move to Recycle Bin
              <span className="hint" style={{ marginLeft: '0.5rem' }}>
                Del
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="context-menu-item danger"
              onClick={() => void deleteImagesPermanent([contextMenu.fileName])}
            >
              Delete permanently
              <span className="hint" style={{ marginLeft: '0.5rem' }}>
                Shift+Del
              </span>
            </button>
          </>
        )}
      </div>
    ) : null

  const onThumbDragStart = useCallback(
    (fileName: string, e: React.DragEvent) => {
      let moving = selectedSet.has(fileName)
        ? orderedIds.filter((id) => selectedSet.has(id))
        : [fileName]
      if (!moving.includes(fileName)) moving = [fileName]
      if (!selectedSet.has(fileName)) {
        applySelection([fileName], fileName, fileName)
      } else if (props.selected !== fileName) {
        useAppStore.setState({ selectedImage: fileName })
      }
      suppressClickAfterDrag.current = true
      const payload = encodeDatasetImageDragPayload({
        sourceDatasetId: props.datasetId,
        fileNames: moving
      })
      e.dataTransfer.setData(DATASET_IMAGE_DRAG_MIME, payload)
      e.dataTransfer.setData(
        'text/plain',
        moving.length === 1 ? fileName : `${moving.length} images`
      )
      e.dataTransfer.effectAllowed = 'copyMove'
    },
    [applySelection, orderedIds, props, selectedSet]
  )

  const thumbProps = {
    datasetId: props.datasetId,
    mediaBust,
    onSelect: selectImage,
    onPreview: openPreview,
    onContextMenu: openContextMenu,
    onDragStart: onThumbDragStart
  }

  return (
    <>
      <div
        ref={parentRef}
        className={`image-grid-nav${dragOver ? ' drag-over' : ''}`}
        style={{ height: '100%', overflow: 'auto' }}
        tabIndex={0}
        role="grid"
        aria-label="Dataset images"
        aria-multiselectable="true"
        onKeyDown={onKeyDown}
        onMouseDown={() => parentRef.current?.focus()}
        {...dropProps}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((row) => {
            const start = row.index * columns
            const slice = props.images.slice(start, start + columns)
            return (
              <div
                key={row.key}
                data-index={row.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${rowSize}px`,
                  transform: `translateY(${row.start}px)`,
                  display: 'grid',
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                  gap: `${GRID_GAP}px`,
                  boxSizing: 'border-box',
                  paddingBottom: `${GRID_GAP}px`
                }}
              >
                {slice.map((img) => (
                  <Thumb
                    key={img.fileName}
                    {...thumbProps}
                    img={img}
                    active={selectedSet.has(img.fileName)}
                    processing={props.processingFileName === img.fileName}
                  />
                ))}
              </div>
            )
          })}
        </div>
      </div>
      {preview}
      {menu}
    </>
  )
}

function Thumb(props: {
  datasetId: string
  img: ImageEntry
  active: boolean
  processing?: boolean
  mediaBust: number
  onSelect: (fileName: string, e: React.MouseEvent) => void
  onPreview: (fileName: string) => void
  onContextMenu: (fileName: string, e: React.MouseEvent) => void
  onDragStart: (fileName: string, e: React.DragEvent) => void
}): React.JSX.Element {
  const src = datasetThumbUrl(
    props.datasetId,
    props.img.fileName,
    // Tip ADS edits do not change $DATA mtime/size — include versionCount so Chromium re-fetches.
    `${props.img.mtimeMs}-${props.img.sizeBytes}-v${props.img.versionCount}-${props.mediaBust}`
  )
  const className = [
    'thumb',
    props.active ? 'active' : '',
    props.processing ? 'processing' : '',
    props.img.hasSpawned ? 'spawned' : ''
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button
      type="button"
      className={className}
      tabIndex={-1}
      draggable
      onMouseDown={(e) => {
        // Avoid native text selection while multi-selecting.
        if (e.shiftKey || e.ctrlKey || e.metaKey) e.preventDefault()
      }}
      onClick={(e) => props.onSelect(props.img.fileName, e)}
      onDoubleClick={() => props.onPreview(props.img.fileName)}
      onContextMenu={(e) => props.onContextMenu(props.img.fileName, e)}
      onDragStart={(e) => props.onDragStart(props.img.fileName, e)}
      title={
        props.img.hasSpawned
          ? `${props.img.fileName} · used as Create New Dataset source`
          : `${props.img.fileName}\nDrag to another dataset · Shift+drag to copy`
      }
    >
      <img src={src} alt={props.img.fileName} loading="lazy" decoding="async" draggable={false} />
      {props.img.hasOriginal && (
        <span
          className="badge-upscaled"
          title={
            props.img.versionCount > 1
              ? `${props.img.versionCount} edit versions — right-click → Undo last / Revert to original`
              : 'Has edit versions — right-click → Undo last / Revert to original'
          }
        >
          <ImageUpscale size={10} strokeWidth={2.5} aria-hidden="true" />
        </span>
      )}
      {!props.img.captionExists && <span className="badge">no txt</span>}
    </button>
  )
}
