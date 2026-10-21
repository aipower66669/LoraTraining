import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

describe('python-shims sitecustomize', () => {
  it('ships sitecustomize.py under resources/python-shims', () => {
    const p = join(process.cwd(), 'resources', 'python-shims', 'sitecustomize.py')
    expect(existsSync(p)).toBe(true)
  })

  it('ships train_bootstrap.py and lora_safetensors_patch.py', () => {
    const dir = join(process.cwd(), 'resources', 'python-shims')
    expect(existsSync(join(dir, 'train_bootstrap.py'))).toBe(true)
    expect(existsSync(join(dir, 'lora_safetensors_patch.py'))).toBe(true)
  })
})
