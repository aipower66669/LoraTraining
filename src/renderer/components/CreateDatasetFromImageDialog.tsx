import { useEffect, useState } from 'react'
import type { CategorySummary, DatasetDetail } from '@shared/ipc/contract'
import { DEFAULT_CATEGORY_ID } from '@shared/schemas/category'
import { ConfirmDialog } from './ConfirmDialog'
import { unwrap } from '../store'

const LAST_ADD_CATEGORY_KEY = 'lora-training:last-add-category-id'
const LAST_CREATE_FROM_IMAGE_NAME_KEY = 'lora-training:last-create-from-image-name'

function readLastAddCategoryId(): string {
  try {
    return localStorage.getItem(LAST_ADD_CATEGORY_KEY) || DEFAULT_CATEGORY_ID
  } catch {
    return DEFAULT_CATEGORY_ID
  }
}

function writeLastAddCategoryId(categoryId: string): void {
  try {
    localStorage.setItem(LAST_ADD_CATEGORY_KEY, categoryId)
  } catch {
    /* ignore */
  }
}

function readLastCreateFromImageName(): string {
  try {
    return localStorage.getItem(LAST_CREATE_FROM_IMAGE_NAME_KEY)?.trim() || ''
  } catch {
    return ''
  }
}

function writeLastCreateFromImageName(name: string): void {
  try {
    localStorage.setItem(LAST_CREATE_FROM_IMAGE_NAME_KEY, name.trim())
  } catch {
    /* ignore */
  }
}

export interface CreateDatasetFromImageDialogProps {
  open: boolean
  sourceDatasetId: string
  fileName: string
  categories: CategorySummary[]
  onClose: () => void
  onCreated: (created: DatasetDetail, datasetName: string) => void
  onError: (message: string) => void
}

/** Prompt for category + name, then copy one image (+ sidecars) into a new dataset. */
export function CreateDatasetFromImageDialog(
  props: CreateDatasetFromImageDialogProps
): React.JSX.Element {
  const { open, sourceDatasetId, fileName, categories, onClose, onCreated, onError } = props

  const categoryOptions =
    categories.length > 0
      ? categories
      : [
          {
            id: DEFAULT_CATEGORY_ID,
            name: 'General',
            sortOrder: 0,
            folderPath: '',
            createdAt: '',
            updatedAt: ''
          }
        ]

  const folderBacked = categoryOptions.filter((c) => c.folderPath?.trim())
  const [name, setName] = useState(() => readLastCreateFromImageName())
  const [categoryId, setCategoryId] = useState(readLastAddCategoryId)
  const [newCategory, setNewCategory] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    const lastId = readLastAddCategoryId()
    const stillExists = folderBacked.some((c) => c.id === lastId)
    setCategoryId(
      stillExists ? lastId : (folderBacked[0]?.id ?? categoryOptions[0]?.id ?? DEFAULT_CATEGORY_ID)
    )
    setName(readLastCreateFromImageName())
    setNewCategory(false)
    setNewCatName('')
    setBusy(false)
     
  }, [open])

  async function confirm(): Promise<void> {
    const datasetName = name.trim()
    if (!datasetName) {
      onError('Enter a dataset name')
      return
    }
    setBusy(true)
    try {
      let catId = categoryId
      if (newCategory) {
        const catName = newCatName.trim()
        if (!catName) {
          onError('New category needs a name')
          setBusy(false)
          return
        }
        const createdCat = unwrap(
          await window.loraTraining.categories.create({ name: catName })
        ) as CategorySummary
        catId = createdCat.id
      } else {
        const cat = categoryOptions.find((c) => c.id === catId)
        if (!cat?.folderPath?.trim()) {
          onError('Pick a folder-backed category (or create a new one under the library root).')
          setBusy(false)
          return
        }
      }

      const created = unwrap(
        await window.loraTraining.datasets.createFromImage({
          sourceDatasetId,
          fileName,
          name: datasetName,
          categoryId: catId
        })
      ) as DatasetDetail

      writeLastAddCategoryId(catId)
      writeLastCreateFromImageName(datasetName)
      onClose()
      onCreated(created, datasetName)
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConfirmDialog
      open={open}
      title="Create dataset from image"
      confirmLabel={busy ? 'Creating…' : 'Create'}
      compact
      enterConfirms
      confirmDisabled={busy}
      onCancel={() => {
        if (busy) return
        onClose()
      }}
      onConfirm={() => void confirm()}
    >
      <div className="form-grid">
        <label>
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Dataset folder name"
            autoFocus
            disabled={busy}
          />
        </label>
        <label>
          Category
          <select
            value={newCategory ? '__new__' : categoryId}
            disabled={busy}
            onChange={(e) => {
              if (e.target.value === '__new__') {
                setNewCategory(true)
                return
              }
              setNewCategory(false)
              const id = e.target.value
              setCategoryId(id)
              writeLastAddCategoryId(id)
            }}
          >
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.id} disabled={!c.folderPath?.trim()}>
                {c.name}
                {c.folderPath?.trim() ? '' : ' (no folder)'}
              </option>
            ))}
            <option value="__new__">+ New category…</option>
          </select>
        </label>
        {newCategory ? (
          <label>
            New category name
            <input
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              placeholder="Category name"
              disabled={busy}
            />
          </label>
        ) : null}
      </div>
    </ConfirmDialog>
  )
}
