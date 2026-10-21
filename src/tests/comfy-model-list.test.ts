import { describe, expect, it } from 'vitest'
import {
  parseModelsPayload,
  parseObjectInfoComboLists
} from '../main/comfy/modelList'

describe('parseModelsPayload', () => {
  it('accepts a bare string array', () => {
    expect(parseModelsPayload(['a.safetensors', 'b.safetensors'])).toEqual([
      'a.safetensors',
      'b.safetensors'
    ])
  })
})

describe('parseObjectInfoComboLists', () => {
  it('reads CheckpointLoaderSimple ckpt_name', () => {
    const names = parseObjectInfoComboLists({
      CheckpointLoaderSimple: {
        input: {
          required: {
            ckpt_name: [['flux.safetensors', 'sdxl.safetensors'], {}]
          }
        }
      }
    })
    expect(names).toEqual(['flux.safetensors', 'sdxl.safetensors'])
  })

  it('reads UNETLoader unet_name', () => {
    const names = parseObjectInfoComboLists({
      UNETLoader: {
        input: {
          required: {
            unet_name: [['krea.safetensors'], {}],
            weight_dtype: [['default', 'fp8_e4m3fn'], {}]
          }
        }
      }
    })
    expect(names).toContain('krea.safetensors')
    expect(names).not.toContain('default')
  })
})
