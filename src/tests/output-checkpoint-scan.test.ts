import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CHECKPOINT_SCAN_MAX_DEPTH,
  shouldSkipOutputSubtree
} from '@shared/output-checkpoint-scan'
import { listCheckpointSafetensorsShallow } from '../main/datasets/listCheckpoints'

describe('shouldSkipOutputSubtree', () => {
  it('skips preview folders and cache-like names', () => {
    expect(shouldSkipOutputSubtree('Set 1')).toBe(true)
    expect(shouldSkipOutputSubtree('Stress 2')).toBe(true)
    expect(shouldSkipOutputSubtree('Weight 1')).toBe(true)
    expect(shouldSkipOutputSubtree('.hidden')).toBe(true)
    expect(shouldSkipOutputSubtree('latent_cache')).toBe(true)
    expect(shouldSkipOutputSubtree('samples')).toBe(true)
    expect(shouldSkipOutputSubtree('MyLora')).toBe(false)
  })
})

describe('listCheckpointSafetensorsShallow', () => {
  it(`only scans depth 0–${CHECKPOINT_SCAN_MAX_DEPTH} and skips cache trees`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'ckpt-scan-'))
    try {
      await writeFile(join(root, 'job_000000100.safetensors'), 'a')
      await mkdir(join(root, 'jobname'), { recursive: true })
      await writeFile(join(root, 'jobname', 'job_000000200.safetensors'), 'b')
      await mkdir(join(root, 'latent_cache', 'deep'), { recursive: true })
      await writeFile(join(root, 'latent_cache', 'deep', 'buried.safetensors'), 'c')
      await mkdir(join(root, 'jobname', 'nested'), { recursive: true })
      await writeFile(join(root, 'jobname', 'nested', 'too_deep.safetensors'), 'd')
      await mkdir(join(root, 'Set 1'), { recursive: true })
      await writeFile(join(root, 'Set 1', 'fake.safetensors'), 'e')

      const hits = await listCheckpointSafetensorsShallow(root)
      const names = hits.map((h) => h.fileName).sort()
      expect(names).toEqual(['job_000000100.safetensors', 'job_000000200.safetensors'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
