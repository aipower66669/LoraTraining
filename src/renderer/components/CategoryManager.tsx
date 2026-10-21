import { useState } from 'react'
import { ArrowDown, ArrowUp, FolderOpen, Pencil, Trash2 } from 'lucide-react'
import type { CategorySummary } from '@shared/ipc/contract'
import { ConfirmDialog } from './ConfirmDialog'
import { unwrap, useAppStore } from '../store'

function shortPath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) return ''
  if (trimmed.length <= 42) return trimmed
  return `…${trimmed.slice(-40)}`
}

/** Renderer-safe: absolute path → relative under library root (no node:path). */
function relativeUnderLibraryUi(libraryRoot: string, absolutePath: string): string {
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const root = norm(libraryRoot)
  const abs = norm(absolutePath)
  if (!root) throw new Error('Library root is not configured')
  if (abs.toLowerCase() === root.toLowerCase()) {
    throw new Error('Category folder cannot be the library root itself')
  }
  if (!abs.toLowerCase().startsWith(root.toLowerCase() + '/')) {
    throw new Error(`Category folder must be inside the library root (${libraryRoot})`)
  }
  const rel = abs.slice(root.length).replace(/^\/+/, '')
  const parts = rel
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0 || parts.some((p) => p === '.' || p === '..')) {
    throw new Error(`Invalid category folder: ${absolutePath}`)
  }
  return parts.join('/')
}

export function CategoryManager(props: {
  open: boolean
  categories: CategorySummary[]
  onClose: () => void
  onChanged: () => Promise<void>
}): React.JSX.Element | null {
  const libraryRoot = useAppStore((s) => s.settings?.libraryRoot ?? '')
  const [name, setName] = useState('')
  const [folder, setFolder] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editFolder, setEditFolder] = useState('')
  const [pickingFolder, setPickingFolder] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!props.open) return null

  function cancelEdit(): void {
    setEditingId(null)
    setEditName('')
    setEditFolder('')
  }

  async function pickRelativeFolder(apply: (rel: string) => void): Promise<void> {
    if (!libraryRoot.trim()) {
      setError('Set library root in Settings before picking a category folder.')
      return
    }
    setPickingFolder(true)
    try {
      setError(null)
      const { path } = unwrap(await window.loraTraining.system.chooseFolder()) as {
        path: string | null
      }
      if (!path) return
      try {
        apply(relativeUnderLibraryUi(libraryRoot, path))
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPickingFolder(false)
    }
  }

  async function create(): Promise<void> {
    try {
      setError(null)
      const trimmedName = name.trim()
      if (!trimmedName) return
      unwrap(
        await window.loraTraining.categories.create({
          name: trimmedName,
          folder: folder.trim() || undefined
        })
      )
      setName('')
      setFolder('')
      await props.onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function saveEdit(): Promise<boolean> {
    if (!editingId) return true
    try {
      setError(null)
      unwrap(
        await window.loraTraining.categories.update({
          id: editingId,
          name: editName.trim(),
          folder: editFolder.trim()
        })
      )
      cancelEdit()
      await props.onChanged()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    }
  }

  async function finish(): Promise<void> {
    if (editingId) {
      const ok = await saveEdit()
      if (!ok) return
    }
    props.onClose()
  }

  async function remove(id: string): Promise<void> {
    try {
      setError(null)
      unwrap(await window.loraTraining.categories.remove(id))
      await props.onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function move(id: string, dir: -1 | 1): Promise<void> {
    const ids = props.categories.map((c) => c.id)
    const idx = ids.indexOf(id)
    const swap = idx + dir
    if (idx < 0 || swap < 0 || swap >= ids.length) return
    ;[ids[idx], ids[swap]] = [ids[swap]!, ids[idx]!]
    unwrap(await window.loraTraining.categories.reorder(ids))
    await props.onChanged()
  }

  return (
    <ConfirmDialog
      open={props.open}
      title="Categories"
      confirmLabel="Done"
      dismissDisabled={pickingFolder}
      onCancel={props.onClose}
      onConfirm={() => void finish()}
    >
      <p className="hint">
        Categories live under your library root (Settings). Folder may be nested (e.g.{' '}
        <span className="mono">Group/Category</span>). Subfolders with JPG/PNG images are discovered
        as datasets. Deleting a category moves its datasets to another category when one remains.
      </p>
      {error && <div className="error-banner">{error}</div>}
      <div className="category-add-block">
        <div className="toolbar category-add-row">
          <input
            placeholder="New category name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create()
            }}
          />
          <button
            type="button"
            className="primary"
            disabled={!name.trim() || pickingFolder}
            onClick={() => void create()}
          >
            Add
          </button>
        </div>
        <div className="toolbar category-add-row">
          <input
            className="mono"
            placeholder="Folder under library (optional — defaults from name)"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create()
            }}
            title="Relative path under library root, e.g. People/Portraits"
          />
          <button
            type="button"
            className="icon-btn path-browse-btn"
            title="Browse for a folder inside the library root"
            aria-label="Browse category folder"
            disabled={pickingFolder}
            onClick={() => void pickRelativeFolder(setFolder)}
          >
            <FolderOpen size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="list" style={{ marginTop: '0.75rem', maxHeight: 320, overflow: 'auto' }}>
        {props.categories.map((c, i) => (
          <div key={c.id} className="list-item category-row">
            {editingId === c.id ? (
              <div className="category-row-edit category-row-edit-full">
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveEdit()
                    if (e.key === 'Escape') {
                      e.stopPropagation()
                      cancelEdit()
                    }
                  }}
                  autoFocus
                  placeholder="Category name"
                />
                <div className="toolbar category-add-row" style={{ marginBottom: 0 }}>
                  <input
                    className="mono"
                    value={editFolder}
                    onChange={(e) => setEditFolder(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveEdit()
                      if (e.key === 'Escape') {
                        e.stopPropagation()
                        cancelEdit()
                      }
                    }}
                    placeholder="Folder under library"
                    title="Relative path under library root, e.g. People/Portraits"
                  />
                  <button
                    type="button"
                    className="icon-btn path-browse-btn"
                    title="Browse for a folder inside the library root"
                    aria-label="Browse category folder"
                    disabled={pickingFolder}
                    onClick={() => void pickRelativeFolder(setEditFolder)}
                  >
                    <FolderOpen size={16} strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
                <div className="toolbar category-add-row" style={{ marginBottom: 0 }}>
                  <button
                    type="button"
                    className="primary"
                    disabled={pickingFolder}
                    onClick={() => void saveEdit()}
                  >
                    Save
                  </button>
                  <button type="button" disabled={pickingFolder} onClick={cancelEdit}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <span className="category-row-name">{c.name}</span>
                {c.folder?.trim() ? (
                  <span className="hint mono category-folder-badge" title={c.folderPath || c.folder}>
                    {shortPath(c.folder)}
                  </span>
                ) : c.folderPath?.trim() ? (
                  <span className="hint mono category-folder-badge" title={c.folderPath}>
                    {shortPath(c.folderPath)}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="icon-btn"
                  disabled={i === 0}
                  title="Move up"
                  onClick={() => void move(c.id, -1)}
                >
                  <ArrowUp size={14} strokeWidth={2} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  disabled={i === props.categories.length - 1}
                  title="Move down"
                  onClick={() => void move(c.id, 1)}
                >
                  <ArrowDown size={14} strokeWidth={2} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title="Edit name and folder"
                  onClick={() => {
                    setEditingId(c.id)
                    setEditName(c.name)
                    setEditFolder(c.folder?.trim() || '')
                  }}
                >
                  <Pencil size={14} strokeWidth={2} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-btn danger"
                  title="Delete category"
                  onClick={() => void remove(c.id)}
                >
                  <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </ConfirmDialog>
  )
}
