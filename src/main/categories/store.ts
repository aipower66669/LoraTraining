import { mkdir, readFile, rename, rm, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join } from 'node:path'
import { nanoid } from 'nanoid'
import {
  CategoriesFileSchema,
  CategoryRecordSchema,
  CategorySidecarSchema,
  type CategoryRecord
} from '@shared/schemas/category'
import {
  CATEGORY_SIDECAR,
  LIBRARY_CATEGORIES_FILE,
  categoryDir,
  categorySidecarPath,
  normalizeCategoryRelativeFolder,
  resolveCategoryFolderInput,
  sanitizeCategoryFolderName
} from '@shared/library-paths'
import { appError } from '@shared/errors'
import { atomicWriteJson } from '../security/atomic-write'
import { logger } from '../logging'
import { getLibraryRoot, loadSettings, tryGetLibraryRoot } from '../settings/store'
import { assertAbsolutePath } from '../security/path-guards'

let cache: CategoryRecord[] | null = null

export function invalidateCategoryCache(): void {
  cache = null
}

function categoriesCatalogPath(): string {
  return join(getLibraryRoot(), LIBRARY_CATEGORIES_FILE)
}

function toRuntime(c: {
  id: string
  name: string
  sortOrder: number
  folder: string
  createdAt: string
  updatedAt: string
}): CategoryRecord {
  const folder = c.folder.trim()
    ? normalizeCategoryRelativeFolder(c.folder)
    : ''
  const folderPath = folder ? categoryDir(getLibraryRoot(), folder) : ''
  return CategoryRecordSchema.parse({
    ...c,
    folder,
    folderPath
  })
}

function toCatalogEntry(c: CategoryRecord): {
  id: string
  name: string
  sortOrder: number
  folder: string
  createdAt: string
  updatedAt: string
} {
  return {
    id: c.id,
    name: c.name,
    sortOrder: c.sortOrder,
    folder: normalizeCategoryRelativeFolder(c.folder || sanitizeCategoryFolderName(c.name)),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt
  }
}

async function persist(categories: CategoryRecord[]): Promise<CategoryRecord[]> {
  const root = getLibraryRoot()
  const sorted = [...categories].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
  )
  await mkdir(root, { recursive: true })
  const catalog = sorted.map(toCatalogEntry)
  await atomicWriteJson(categoriesCatalogPath(), { version: 1, categories: catalog })
  for (const c of sorted) {
    const folder = normalizeCategoryRelativeFolder(c.folder || sanitizeCategoryFolderName(c.name))
    const dir = categoryDir(root, folder)
    await mkdir(dir, { recursive: true })
    await atomicWriteJson(categorySidecarPath(root, folder), {
      version: 1,
      id: c.id,
      name: c.name,
      sortOrder: c.sortOrder,
      folder,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt
    })
  }
  cache = sorted.map((c) =>
    toRuntime({
      ...toCatalogEntry(c),
      folder: normalizeCategoryRelativeFolder(c.folder || sanitizeCategoryFolderName(c.name))
    })
  )
  return cache
}

export async function listCategories(): Promise<CategoryRecord[]> {
  if (cache) return cache
  await loadSettings()
  const root = tryGetLibraryRoot()
  if (!root) {
    cache = []
    return cache
  }
  try {
    const raw = await readFile(join(root, LIBRARY_CATEGORIES_FILE), 'utf8')
    const parsed = CategoriesFileSchema.parse(JSON.parse(raw))
    cache = parsed.categories
      .map((c) => toRuntime(c))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    return cache
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : ''
    if (code === 'ENOENT') {
      return persist([])
    }
    logger.error({ err }, 'Failed to read library categories.json')
    cache = []
    return cache
  }
}

export async function getCategory(id: string): Promise<CategoryRecord> {
  const all = await listCategories()
  const found = all.find((c) => c.id === id)
  if (!found) {
    throw appError('not-found', `Category not found: ${id}`, {
      remediation: 'Pick an existing category or create a new one.'
    })
  }
  return found
}

export async function ensureCategoryExists(id: string): Promise<CategoryRecord | null> {
  const all = await listCategories()
  return all.find((c) => c.id === id) ?? null
}

export async function createCategory(input: {
  name: string
  /** Relative folder under libraryRoot (e.g. `Group/Category`), or absolute path under the library. */
  folder?: string
  /** @deprecated Prefer `folder`. Absolute path under libraryRoot is still accepted. */
  folderPath?: string
}): Promise<CategoryRecord> {
  await loadSettings()
  if (!tryGetLibraryRoot()) {
    throw appError('validation', 'Library root is not configured', {
      remediation: 'Set libraryRoot in settings to your library folder (e.g. F:\\migration).'
    })
  }
  const name = input.name.trim()
  if (!name) {
    throw appError('validation', 'Category name is required')
  }
  const all = await listCategories()
  if (all.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
    throw appError('validation', `Category “${name}” already exists`)
  }
  const root = getLibraryRoot()
  let folder: string
  try {
    folder = resolveCategoryFolderInput(root, input.folder ?? input.folderPath, name)
  } catch (err) {
    throw appError('validation', err instanceof Error ? err.message : String(err), {
      remediation: 'Pick a folder inside the library root, or type a relative path like Group/Category.'
    })
  }
  const taken = new Set(all.map((c) => normalizeCategoryRelativeFolder(c.folder).toLowerCase()))
  if (taken.has(folder.toLowerCase())) {
    throw appError('validation', `Another category already uses folder “${folder}”`, {
      remediation: 'Choose a different relative folder under the library root.'
    })
  }
  const now = new Date().toISOString()
  const maxOrder = all.reduce((m, c) => Math.max(m, c.sortOrder), -1)
  const record = toRuntime({
    id: nanoid(),
    name,
    folder,
    sortOrder: maxOrder + 1,
    createdAt: now,
    updatedAt: now
  })
  await mkdir(assertAbsolutePath(record.folderPath), { recursive: true })
  await persist([...all, record])
  return (await listCategories()).find((c) => c.id === record.id)!
}

export async function updateCategory(input: {
  id: string
  name?: string
  sortOrder?: number
  /** Relative folder under libraryRoot, or absolute path under the library. */
  folder?: string
  /** @deprecated Prefer `folder`. Absolute path under libraryRoot is still accepted. */
  folderPath?: string
}): Promise<CategoryRecord> {
  const all = await listCategories()
  const idx = all.findIndex((c) => c.id === input.id)
  if (idx < 0) {
    throw appError('not-found', `Category not found: ${input.id}`)
  }
  const current = all[idx]!
  const name = input.name?.trim() ?? current.name
  if (!name) {
    throw appError('validation', 'Category name is required')
  }
  if (all.some((c) => c.id !== input.id && c.name.toLowerCase() === name.toLowerCase())) {
    throw appError('validation', `Category “${name}” already exists`)
  }

  const root = getLibraryRoot()
  let folder = normalizeCategoryRelativeFolder(current.folder)

  const folderInput = input.folder ?? input.folderPath
  if (folderInput !== undefined) {
    try {
      folder = resolveCategoryFolderInput(root, folderInput, name)
    } catch (err) {
      throw appError('validation', err instanceof Error ? err.message : String(err), {
        remediation:
          'Pick a folder inside the library root, or type a relative path like Group/Category.'
      })
    }
  } else if (input.name !== undefined) {
    // Nested relative folders (e.g. Group/Category) are user-managed — renaming the
    // display name must not flatten or rewrite the path. Only auto-rename simple
    // single-segment folders that still match the old sanitized name.
    const isNested = folder.includes('/')
    const oldLeaf = folder.includes('/') ? folder.slice(folder.lastIndexOf('/') + 1) : folder
    if (!isNested && sanitizeCategoryFolderName(name) !== oldLeaf) {
      folder = sanitizeCategoryFolderName(name)
    }
  }

  if (folder !== normalizeCategoryRelativeFolder(current.folder)) {
    const taken = new Set(
      all
        .filter((c) => c.id !== input.id)
        .map((c) => normalizeCategoryRelativeFolder(c.folder).toLowerCase())
    )
    if (taken.has(folder.toLowerCase())) {
      throw appError('validation', `Another category already uses folder “${folder}”`, {
        remediation: 'Choose a different relative folder under the library root.'
      })
    }
    const from = categoryDir(root, current.folder)
    const to = categoryDir(root, folder)
    let fromExists = false
    let toExists = false
    try {
      await access(from, constants.F_OK)
      fromExists = true
    } catch {
      /* missing */
    }
    try {
      await access(to, constants.F_OK)
      toExists = true
    } catch {
      /* missing */
    }
    try {
      if (fromExists && !toExists) {
        await mkdir(dirname(to), { recursive: true })
        await rename(from, to)
      } else if (!toExists) {
        await mkdir(to, { recursive: true })
      }
      // If `to` already exists, retarget the category to that folder (leave old dir alone).
    } catch (err) {
      logger.warn({ err, from, to }, 'category folder relocate failed')
      throw appError('validation', `Could not move category folder to “${folder}”`, {
        remediation: 'Check that the path is writable and not locked by another program.'
      })
    }
  }

  const next = toRuntime({
    id: current.id,
    name,
    folder,
    sortOrder: input.sortOrder ?? current.sortOrder,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString()
  })
  const copy = [...all]
  copy[idx] = next
  // Remove stale sidecar if folder relocated away from the old path
  if (folder !== normalizeCategoryRelativeFolder(current.folder)) {
    await rm(join(categoryDir(root, current.folder), CATEGORY_SIDECAR), { force: true }).catch(
      () => undefined
    )
  }
  await persist(copy)
  return (await listCategories()).find((c) => c.id === input.id)!
}

export async function removeCategory(id: string): Promise<{
  deleted: true
  movedToCategoryId: string | null
}> {
  const all = await listCategories()
  if (!all.some((c) => c.id === id)) {
    throw appError('not-found', `Category not found: ${id}`)
  }
  const remaining = all.filter((c) => c.id !== id)
  await persist(remaining)
  const movedToCategoryId = remaining[0]?.id ?? null
  return { deleted: true, movedToCategoryId }
}

export async function reorderCategories(orderedIds: string[]): Promise<CategoryRecord[]> {
  const all = await listCategories()
  const byId = new Map(all.map((c) => [c.id, c]))
  const next: CategoryRecord[] = []
  orderedIds.forEach((id, sortOrder) => {
    const c = byId.get(id)
    if (c) {
      next.push({ ...c, sortOrder, updatedAt: new Date().toISOString() })
      byId.delete(id)
    }
  })
  for (const c of byId.values()) {
    next.push({ ...c, sortOrder: next.length, updatedAt: new Date().toISOString() })
  }
  return persist(next)
}

/** Read sidecar if present (diagnostics). */
export async function readCategorySidecar(relativeFolder: string): Promise<unknown> {
  const raw = await readFile(categorySidecarPath(getLibraryRoot(), relativeFolder), 'utf8')
  return CategorySidecarSchema.parse(JSON.parse(raw))
}
