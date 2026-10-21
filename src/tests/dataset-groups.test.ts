import { describe, expect, it } from 'vitest'
import { groupDatasetsByCategory } from '@shared/dataset-groups'
import type { CategorySummary, DatasetSummary } from '@shared/ipc/contract'

function cat(id: string, name: string, sortOrder = 0): CategorySummary {
  return { id, name, sortOrder, folderPath: '', createdAt: '', updatedAt: '' }
}

function ds(id: string, name: string, categoryId: string): DatasetSummary {
  return {
    id,
    name,
    folderPath: `/x/${name}`,
    categoryId,
    trigger: '',
    stats: { images: 1, captions: 0, stemCollisions: [] },
    updatedAt: '',
    coverFileName: null,
    ready: false,
    trained: false,
    validated: false,
    done: false,
    status: 'none'
  }
}

describe('groupDatasetsByCategory', () => {
  it('groups under matching categories', () => {
    const groups = groupDatasetsByCategory(
      [cat('general', 'General'), cat('a', 'A')],
      [ds('1', 'One', 'a'), ds('2', 'Two', 'general')]
    )
    expect(groups.map((g) => g.category.id)).toEqual(['general', 'a'])
    expect(groups[1]!.datasets.map((d) => d.id)).toEqual(['1'])
  })

  it('keeps orphan category datasets visible', () => {
    const groups = groupDatasetsByCategory(
      [cat('general', 'General')],
      [ds('1', 'Orphan', 'missing-cat')]
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]!.category.name).toBe('Uncategorized')
    expect(groups[0]!.datasets[0]!.id).toBe('1')
  })

  it('shows empty folder-backed categories', () => {
    const folderCat = { ...cat('f', 'Foldered'), folderPath: 'F:/datasets' }
    const groups = groupDatasetsByCategory([folderCat, cat('empty', 'Empty')], [])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.category.id).toBe('f')
    expect(groups[0]!.datasets).toEqual([])
  })
})
