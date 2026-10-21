import { useCallback, useEffect, useState } from 'react'
import { unwrap, useAppStore } from '../store'
import { useClampedMenuPosition } from '../util/contextMenuPosition'

export type RevealMenuState = {
  x: number
  y: number
  /** Path relative to the dataset folder root (e.g. `output/foo.safetensors` or `photo.jpg`). */
  relativePath: string
}

/** Normalize a path under `{dataset}/output/…`. */
export function outputAssetRelativePath(pathUnderOutput: string): string {
  const clean = pathUnderOutput.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!clean) return 'output'
  if (clean === 'output' || clean.startsWith('output/')) return clean
  return `output/${clean}`
}

export type RevealInExplorerMenuOptions = {
  /** When set, the menu includes a Delete item for the revealed path. */
  onDelete?: (relativePath: string) => void | Promise<void>
  deleteLabel?: string
  deleteTitle?: string
}

/**
 * Right-click “Reveal in Explorer” menu for dataset / output assets.
 * Optionally add Delete when `onDelete` is provided.
 */
export function useRevealInExplorerMenu(
  datasetId: string,
  opts?: RevealInExplorerMenuOptions
): {
  menu: RevealMenuState | null
  openRevealMenu: (e: React.MouseEvent, relativePath: string) => void
  closeRevealMenu: () => void
  revealMenuEl: React.ReactNode
} {
  const setStatus = useAppStore((s) => s.setStatus)
  const setError = useAppStore((s) => s.setError)
  const [menu, setMenu] = useState<RevealMenuState | null>(null)
  const { menuRef, menuStyle } = useClampedMenuPosition(
    menu ? { x: menu.x, y: menu.y } : null
  )
  const onDelete = opts?.onDelete
  const deleteLabel = opts?.deleteLabel ?? 'Delete'
  const deleteTitle = opts?.deleteTitle

  const closeRevealMenu = useCallback(() => setMenu(null), [])

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const openRevealMenu = useCallback((e: React.MouseEvent, relativePath: string) => {
    e.preventDefault()
    e.stopPropagation()
    const path = relativePath.replace(/\\/g, '/').replace(/^\/+/, '').trim()
    if (!path) return
    setMenu({ x: e.clientX, y: e.clientY, relativePath: path })
  }, [])

  const reveal = useCallback(async () => {
    if (!menu) return
    const { relativePath } = menu
    setMenu(null)
    try {
      unwrap(await window.loraTraining.datasets.revealRelativePath(datasetId, relativePath))
      setStatus(`Revealed ${relativePath}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [datasetId, menu, setError, setStatus])

  const deleteItem = useCallback(() => {
    if (!menu || !onDelete) return
    const { relativePath } = menu
    setMenu(null)
    void Promise.resolve(onDelete(relativePath)).catch((err) => {
      setError(err instanceof Error ? err.message : String(err))
    })
  }, [menu, onDelete, setError])

  const revealMenuEl =
    menu != null ? (
      <div
        ref={menuRef}
        className="context-menu"
        style={menuStyle}
        role="menu"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button type="button" role="menuitem" className="context-menu-item" onClick={() => void reveal()}>
          Reveal in Explorer
        </button>
        {onDelete ? (
          <>
            <div className="context-menu-sep" role="separator" />
            <button
              type="button"
              role="menuitem"
              className="context-menu-item danger"
              title={deleteTitle}
              onClick={() => deleteItem()}
            >
              {deleteLabel}
            </button>
          </>
        ) : null}
      </div>
    ) : null

  return { menu, openRevealMenu, closeRevealMenu, revealMenuEl }
}
