import { describe, expect, it } from 'vitest'
import {
  VALIDATION_MODEL_DEFAULT,
  resolveValidationModel
} from '@shared/validation-model'

describe('resolveValidationModel', () => {
  it('uses settings when dataset is Default', () => {
    expect(resolveValidationModel(VALIDATION_MODEL_DEFAULT, 'flux.safetensors')).toBe(
      'flux.safetensors'
    )
    expect(resolveValidationModel('', 'flux.safetensors')).toBe('flux.safetensors')
    expect(resolveValidationModel(undefined, 'flux.safetensors')).toBe('flux.safetensors')
  })

  it('uses dataset override when not Default', () => {
    expect(resolveValidationModel('other.safetensors', 'flux.safetensors')).toBe(
      'other.safetensors'
    )
  })

  it('returns empty when Default and settings empty', () => {
    expect(resolveValidationModel(VALIDATION_MODEL_DEFAULT, '')).toBe('')
    expect(resolveValidationModel(VALIDATION_MODEL_DEFAULT, null)).toBe('')
  })
})
