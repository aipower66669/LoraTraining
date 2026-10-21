import { describe, expect, it } from 'vitest'
import {
  relativeDirUnderRoot,
  resolveDatasetComfySubfolder,
  sanitizeComfySubfolder
} from '@shared/comfy-lora-path'

describe('comfy-lora-path', () => {
  it('sanitizes subfolders', () => {
    expect(sanitizeComfySubfolder('Characters/My Lora')).toBe('Characters/My Lora')
    expect(sanitizeComfySubfolder('../evil')).toBe('evil')
    expect(sanitizeComfySubfolder('')).toBe('')
  })

  it('derives relative dir under LoRA root', () => {
    expect(
      relativeDirUnderRoot('F:/AI/ComfyUI/models/loras', 'F:/AI/ComfyUI/models/loras/Characters/Foo/a.safetensors')
    ).toBe('Characters/Foo')
    expect(
      relativeDirUnderRoot('F:/AI/ComfyUI/models/loras', 'F:/AI/ComfyUI/models/loras/a.safetensors')
    ).toBe('')
  })

  it('resolves global settings subfolder (dataset override ignored)', () => {
    expect(
      resolveDatasetComfySubfolder({
        datasetSubfolder: 'Characters/Foo',
        globalSubfolder: '!Testing'
      })
    ).toBe('!Testing')
    expect(
      resolveDatasetComfySubfolder({
        datasetSubfolder: '',
        globalSubfolder: '!Testing'
      })
    ).toBe('!Testing')
    expect(
      resolveDatasetComfySubfolder({
        datasetSubfolder: 'Characters/Foo',
        globalSubfolder: ''
      })
    ).toBe('!Testing')
  })
})
