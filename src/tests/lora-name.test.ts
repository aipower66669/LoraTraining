import { describe, expect, it } from 'vitest'
import {
  defaultLoraName,
  existingLoraStemFromCheckpointNames,
  loraStemFromCheckpointFileName,
  suggestLoraName
} from '../shared/lora-name'

describe('defaultLoraName', () => {
  it('joins category and dataset with underscores', () => {
    expect(defaultLoraName('Category name', 'Dataset name')).toBe('Category_name_Dataset_name')
  })

  it('falls back to Uncategorized', () => {
    expect(defaultLoraName('', 'FluoKawaii')).toBe('Uncategorized_FluoKawaii')
  })
})

describe('loraStemFromCheckpointFileName', () => {
  it('strips zero-padded step suffix', () => {
    expect(loraStemFromCheckpointFileName('FluoKawaii_000000500.safetensors')).toBe('FluoKawaii')
    expect(loraStemFromCheckpointFileName('Fashion_Fluo_000001000.safetensors')).toBe('Fashion_Fluo')
  })

  it('keeps unnumbered finals', () => {
    expect(loraStemFromCheckpointFileName('FluoKawaii.safetensors')).toBe('FluoKawaii')
  })
})

describe('suggestLoraName', () => {
  it('prefers highest-step checkpoint stem over Category_Dataset', () => {
    expect(
      suggestLoraName({
        categoryName: 'Fashion',
        datasetName: 'FluoKawaii',
        checkpointFileNames: [
          'FluoKawaii_000000250.safetensors',
          'FluoKawaii_000000500.safetensors'
        ]
      })
    ).toBe('FluoKawaii')
  })

  it('uses convention when no checkpoints', () => {
    expect(
      suggestLoraName({
        categoryName: 'Fashion',
        datasetName: 'FluoKawaii',
        checkpointFileNames: []
      })
    ).toBe('Fashion_FluoKawaii')
  })

  it('uses unnumbered final when no numbered steps', () => {
    expect(
      existingLoraStemFromCheckpointNames(['OldRun.safetensors', 'notes.txt'])
    ).toBe('OldRun')
  })
})
