import { useEffect, useState } from 'react'
import type { CategorySummary, DatasetDetail } from '@shared/ipc/contract'
import { DEFAULT_CATEGORY_ID } from '@shared/schemas/category'
import { ConfirmDialog } from './ConfirmDialog'
import { unwrap } from '../store'

const LAST_ADD_CATEGORY_KEY = 'lora-training:last-add-category-id'

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
    /* ignore quota / private mode */
  }
}

export interface AddDatasetDialogProps {
  open: boolean
  categories: CategorySummary[]
  onClose: () => void
  onCreated: (created: DatasetDetail, categoryId: string, datasetName: string) => void
  onError: (message: string) => void
}

/** "Add dataset" dialog: name + category (existing/new/folder-backed) + folder pick. */
export function AddDatasetDialog(props: AddDatasetDialogProps): React.JSX.Element {
  const { open, categories, onClose, onCreated, onError } = props

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

  const [addName, setAddName] = useState('')
  const [addCategoryId, setAddCategoryId] = useState(readLastAddCategoryId)
  const [addNewCategory, setAddNewCategory] = useState(false)
  const [addNewCatName, setAddNewCatName] = useState('')
  const [pendingFolder, setPendingFolder] = useState<{ path: string; name: string } | null>(null)

  // Reset the form defaults every time the dialog is (re)opened, matching the
  // previous `beginAddDataset` behavior.
  useEffect(() => {
    if (!open) return
    const lastId = readLastAddCategoryId()
    const stillExists = categoryOptions.some((c) => c.id === lastId)
    setAddCategoryId(stillExists ? lastId : (categoryOptions[0]?.id ?? DEFAULT_CATEGORY_ID))
    setAddName('')
    setAddNewCategory(false)
    setAddNewCatName('')
    setPendingFolder(null)
    // Only re-run on the open transition — categoryOptions changing shouldn't reset typed input.
     
  }, [open])

  async function confirmAddDataset(): Promise<void> {
    const datasetName = addName.trim()
    if (!datasetName) {
      onError('Enter a dataset name')
      return
    }
    try {
      let categoryId = addCategoryId
      if (addNewCategory) {
        const catName = addNewCatName.trim()
        if (!catName) {
          onError('New category needs a name')
          return
        }
        const createdCat = unwrap(
          await window.loraTraining.categories.create({ name: catName })
        ) as CategorySummary
        categoryId = createdCat.id
      }

      const cat =
        categoryOptions.find((c) => c.id === categoryId) ??
        (await window.loraTraining.categories.list().then((r) => {
          const list = unwrap(r) as CategorySummary[]
          return list.find((c) => c.id === categoryId)
        }))

      let created: DatasetDetail
      if (cat?.folderPath?.trim()) {
        created = unwrap(
          await window.loraTraining.datasets.createInCategory({
            name: datasetName,
            categoryId
          })
        ) as DatasetDetail
      } else {
        let folderPath = pendingFolder?.path
        if (!folderPath) {
          const folder = unwrap(await window.loraTraining.system.chooseFolder()) as {
            path: string | null
          }
          if (!folder.path) return
          folderPath = folder.path
        }
        created = unwrap(
          await window.loraTraining.datasets.create({
            name: datasetName,
            folderPath,
            categoryId
          })
        ) as DatasetDetail
      }

      writeLastAddCategoryId(categoryId)
      onClose()
      setPendingFolder(null)
      onCreated(created, categoryId, datasetName)
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <ConfirmDialog
      open={open}
      title="Add dataset"
      confirmLabel="Add"
      compact
      enterConfirms
      onCancel={() => {
        onClose()
        setPendingFolder(null)
        setAddNewCategory(false)
      }}
      onConfirm={() => void confirmAddDataset()}
    >
      <div className="form-grid">
        <label>
          Name
          <input
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            placeholder="Dataset folder name"
            autoFocus
          />
        </label>
        <label>
          Category
          <select
            value={addNewCategory ? '__new__' : addCategoryId}
            onChange={(e) => {
              if (e.target.value === '__new__') {
                setAddNewCategory(true)
                return
              }
              setAddNewCategory(false)
              const categoryId = e.target.value
              setAddCategoryId(categoryId)
              writeLastAddCategoryId(categoryId)
            }}
          >
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.folderPath?.trim() ? ' (auto)' : ''}
              </option>
            ))}
            <option value="__new__">+ New category…</option>
          </select>
        </label>
        {addNewCategory ? (
          <>
            <label>
              New category name
              <input
                value={addNewCatName}
                onChange={(e) => setAddNewCatName(e.target.value)}
                placeholder="Category name"
              />
            </label>
            <p className="hint" style={{ margin: 0 }}>
              Creates a folder under the library root. Dataset will be a subfolder inside it.
            </p>
          </>
        ) : (
          <p className="hint" style={{ margin: 0 }}>
            {categoryOptions.find((c) => c.id === addCategoryId)?.folderPath?.trim()
              ? 'Creates a new subfolder under the category folder. Drop images into the grid after Add.'
              : 'On Add, you will pick an existing folder on disk (set library root in Settings first).'}
          </p>
        )}
      </div>
    </ConfirmDialog>
  )
}
