import { describe, expect, it } from 'vitest'
import {
  categoryDir,
  normalizeCategoryRelativeFolder,
  relativeFolderUnderLibraryRoot,
  resolveCategoryFolderInput
} from '../shared/library-paths'

describe('normalizeCategoryRelativeFolder', () => {
  it('accepts nested relative paths and normalizes separators', () => {
    expect(normalizeCategoryRelativeFolder('Group/Sub/Category')).toBe('Group/Sub/Category')
    expect(normalizeCategoryRelativeFolder('Group\\Sub\\Category')).toBe('Group/Sub/Category')
    expect(normalizeCategoryRelativeFolder('  a / b / c  ')).toBe('a/b/c')
  })

  it('rejects absolute and parent-escape paths', () => {
    expect(() => normalizeCategoryRelativeFolder('C:/Datasets/Cat')).toThrow(/relative/)
    expect(() => normalizeCategoryRelativeFolder('/absolute')).toThrow(/relative/)
    expect(() => normalizeCategoryRelativeFolder('a/../b')).toThrow(/\.\./)
    expect(() => normalizeCategoryRelativeFolder('a/./b')).toThrow(/\./)
  })
})

describe('relativeFolderUnderLibraryRoot', () => {
  it('converts absolute paths under the library to relative', () => {
    expect(relativeFolderUnderLibraryRoot('F:/Library', 'F:/Library/Group/Cat')).toBe('Group/Cat')
  })

  it('rejects paths outside the library', () => {
    expect(() => relativeFolderUnderLibraryRoot('F:/Library', 'F:/Other/Cat')).toThrow(/inside/)
    expect(() => relativeFolderUnderLibraryRoot('F:/Library', 'F:/Library')).toThrow(/itself/)
  })
})

describe('resolveCategoryFolderInput', () => {
  it('defaults empty input from the category name', () => {
    expect(resolveCategoryFolderInput('F:/Library', '', 'My Cat')).toBe('My Cat')
  })

  it('accepts relative and absolute-under-library inputs', () => {
    expect(resolveCategoryFolderInput('F:/Library', 'Group/Cat', 'X')).toBe('Group/Cat')
    expect(resolveCategoryFolderInput('F:/Library', 'F:/Library/Group/Cat', 'X')).toBe('Group/Cat')
  })
})

describe('categoryDir', () => {
  it('resolves nested folders under libraryRoot', () => {
    const abs = categoryDir('F:/Library', 'SOME_RELATIVE/CATEGORY_FOLDER')
    expect(abs.replace(/\\/g, '/').toLowerCase()).toBe(
      'f:/library/some_relative/category_folder'
    )
  })

  it('keeps single-segment folders working', () => {
    const abs = categoryDir('F:/Library', 'ABDL')
    expect(abs.replace(/\\/g, '/').toLowerCase()).toBe('f:/library/abdl')
  })

  it('resolves !Jobs under library root', async () => {
    const { libraryJobsDir, JOBS_DIR } = await import('../shared/library-paths')
    expect(JOBS_DIR).toBe('!Jobs')
    expect(libraryJobsDir('F:/Library').replace(/\\/g, '/')).toBe('F:/Library/!Jobs')
  })
})
