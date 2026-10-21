import { describe, expect, it } from 'vitest'
import { sanitizeDatasetFolderName, suggestDuplicateDatasetName } from '@shared/schemas/dataset'

describe('sanitizeDatasetFolderName', () => {
  it('strips illegal path characters', () => {
    expect(sanitizeDatasetFolderName('my:set/name?')).toBe('my_set_name_')
  })

  it('trims and collapses whitespace', () => {
    expect(sanitizeDatasetFolderName('  hello   world  ')).toBe('hello world')
  })

  it('falls back when empty', () => {
    expect(sanitizeDatasetFolderName('   ')).toBe('dataset')
    expect(sanitizeDatasetFolderName('...')).toBe('dataset')
  })
})

describe('suggestDuplicateDatasetName', () => {
  it('appends V2 for unversioned names', () => {
    expect(suggestDuplicateDatasetName('My Set')).toBe('My Set V2')
  })

  it('bumps an existing Vn suffix', () => {
    expect(suggestDuplicateDatasetName('My Set V2')).toBe('My Set V3')
    expect(suggestDuplicateDatasetName('My Set v10')).toBe('My Set V11')
  })
})
