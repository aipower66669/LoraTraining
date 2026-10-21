import { describe, expect, it } from 'vitest'
import {
  isCategoryManagedDatasetFolder,
  isDiscoverableDatasetDirName,
  isDiscoveryImageFileName,
  normFolderKey
} from '../main/datasets/categorySync'

describe('category discovery helpers', () => {
  it('accepts jpg jpeg png only', () => {
    expect(isDiscoveryImageFileName('a.jpg')).toBe(true)
    expect(isDiscoveryImageFileName('a.JPEG')).toBe(true)
    expect(isDiscoveryImageFileName('a.png')).toBe(true)
    expect(isDiscoveryImageFileName('a.webp')).toBe(false)
    expect(isDiscoveryImageFileName('a.txt')).toBe(false)
  })

  it('ignores ! and hidden folder names', () => {
    expect(isDiscoverableDatasetDirName('MyLora')).toBe(true)
    expect(isDiscoverableDatasetDirName('!Testing')).toBe(false)
    expect(isDiscoverableDatasetDirName('!archive')).toBe(false)
    expect(isDiscoverableDatasetDirName('.git')).toBe(false)
  })

  it('normalizes folder keys stably', () => {
    const a = normFolderKey('F:/AI/Datasets/Concepts')
    const b = normFolderKey('F:/AI/Datasets/Concepts/')
    expect(a).toBe(b)
  })

  it('treats only immediate children as category-managed', () => {
    const root = 'F:/AI/Cats'
    expect(isCategoryManagedDatasetFolder(root, 'F:/AI/Cats/ConceptA')).toBe(true)
    expect(isCategoryManagedDatasetFolder(root, 'F:/AI/Cats/ConceptA/')).toBe(true)
    expect(isCategoryManagedDatasetFolder(root, 'F:/AI/Cats')).toBe(false)
    expect(isCategoryManagedDatasetFolder(root, 'F:/AI/Cats/ConceptA/nested')).toBe(false)
    expect(isCategoryManagedDatasetFolder(root, 'F:/Other/ConceptA')).toBe(false)
    expect(isCategoryManagedDatasetFolder(root, 'F:/missing/old-dataset')).toBe(false)
  })
})
