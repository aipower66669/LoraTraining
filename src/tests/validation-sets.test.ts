import { describe, expect, it } from 'vitest'
import {
  defaultValidationSetConfig,
  isValidationSetDirName,
  mergeClonedValidationSets,
  validationSetFromPrevious,
  validationSetLabel
} from '@shared/validation-sets'

describe('validation sets', () => {
  it('labels sets as Set N', () => {
    expect(validationSetLabel(0)).toBe('Set 1')
    expect(validationSetLabel(2)).toBe('Set 3')
  })

  it('detects set folder names', () => {
    expect(isValidationSetDirName('Set 1')).toBe(true)
    expect(isValidationSetDirName('Set 12')).toBe(true)
    expect(isValidationSetDirName('output')).toBe(false)
    expect(isValidationSetDirName('Set1')).toBe(false)
  })

  it('defaults set config', () => {
    expect(defaultValidationSetConfig()).toMatchObject({
      prompt: '',
      seed: 0,
      loraWeight: 1,
      styleIndex: 0,
      validationModel: 'Default'
    })
  })

  it('accepts a remembered prompt override', () => {
    expect(defaultValidationSetConfig({ prompt: 'a {cat|dog}' }).prompt).toBe('a {cat|dog}')
  })

  it('clones previous set with seed + 1 when previous seed is > 0', () => {
    expect(
      validationSetFromPrevious({
        prompt: 'a {cat|dog}',
        seed: 42,
        loraWeight: 0.8,
        styleIndex: 1,
        validationModel: 'flux1-dev.safetensors',
        existingCopyPolicy: 'overwrite_if_different'
      })
    ).toMatchObject({
      prompt: 'a {cat|dog}',
      seed: 43,
      loraWeight: 0.8,
      styleIndex: 1,
      validationModel: 'flux1-dev.safetensors',
      existingCopyPolicy: 'overwrite_if_different'
    })
  })

  it('keeps seed 0 when cloning from a set with seed 0', () => {
    expect(
      validationSetFromPrevious({
        prompt: 'x',
        seed: 0,
        loraWeight: 1,
        styleIndex: 0,
        validationModel: 'Default',
        existingCopyPolicy: 'reuse_if_identical_error_if_different'
      }).seed
    ).toBe(0)
  })

  it('merges cloned sets overwrite vs add', () => {
    const current = [
      defaultValidationSetConfig({ prompt: 'here', seed: 1, validationModel: 'Default' })
    ]
    const source = [
      defaultValidationSetConfig({
        prompt: 'from',
        seed: 9,
        validationModel: 'a.safetensors',
        styleIndex: 1
      }),
      defaultValidationSetConfig({ prompt: 'from2', seed: 10 })
    ]
    expect(mergeClonedValidationSets(current, source, 'overwrite')).toEqual([
      expect.objectContaining({ prompt: 'from', seed: 9, validationModel: 'a.safetensors' }),
      expect.objectContaining({ prompt: 'from2', seed: 10 })
    ])
    expect(mergeClonedValidationSets(current, source, 'add')).toEqual([
      expect.objectContaining({ prompt: 'here', seed: 1 }),
      expect.objectContaining({ prompt: 'from', seed: 9 }),
      expect.objectContaining({ prompt: 'from2', seed: 10 })
    ])
  })
})
