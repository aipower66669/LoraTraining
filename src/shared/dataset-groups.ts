import type { CategorySummary, DatasetSummary } from '@shared/ipc/contract'

export type DatasetCategoryGroup = {
  category: CategorySummary
  datasets: DatasetSummary[]
}

/**
 * Group datasets under known categories. Any dataset whose categoryId is missing
 * from `categories` is shown under a fallback group so it never disappears.
 */
export function groupDatasetsByCategory(
  categories: CategorySummary[],
  datasets: DatasetSummary[],
  fallback: CategorySummary = {
    id: '__uncategorized__',
    name: 'Uncategorized',
    sortOrder: Number.MAX_SAFE_INTEGER,
    folderPath: '',
    createdAt: '',
    updatedAt: ''
  }
): DatasetCategoryGroup[] {
  const byCat = new Map<string, DatasetSummary[]>()
  for (const ds of datasets) {
    const list = byCat.get(ds.categoryId) ?? []
    list.push(ds)
    byCat.set(ds.categoryId, list)
  }
  for (const list of byCat.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name))
  }

  const known = new Set(categories.map((c) => c.id))
  const groups: DatasetCategoryGroup[] = categories
    .map((cat) => ({
      category: cat,
      datasets: byCat.get(cat.id) ?? []
    }))
    // Keep folder-backed categories visible even before discovery finds datasets.
    .filter((g) => g.datasets.length > 0 || Boolean(g.category.folderPath?.trim()))

  const orphans: DatasetSummary[] = []
  for (const [catId, list] of byCat) {
    if (!known.has(catId)) orphans.push(...list)
  }
  if (orphans.length > 0) {
    orphans.sort((a, b) => a.name.localeCompare(b.name))
    groups.push({ category: fallback, datasets: orphans })
  }
  return groups
}
