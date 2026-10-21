import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyCheckpointPrefs, isKeepInComfy } from '@shared/checkpoint-prefs'
import { atomicWriteJson } from '../main/security/atomic-write'

const tempDirs: string[] = []
let datasetFolder = ''

async function freshTemp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

beforeEach(async () => {
  vi.resetModules()
  datasetFolder = await freshTemp('lora-prefs-mutate-')
  await mkdir(join(datasetFolder, 'output'), { recursive: true })
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

describe('mutateCheckpointPrefs', () => {
  it('does not let a preview-cache write clobber concurrent keepInComfy=false', async () => {
    const prefs = emptyCheckpointPrefs()
    prefs.keepInComfy['lora_000000250'] = false
    prefs.validationPreviews = {
      lora_000000250: { 'Set 1': 'Set 1/lora_000000250.jpg' }
    }
    await atomicWriteJson(join(datasetFolder, 'output', 'checkpoint-prefs.json'), {
      ...prefs,
      version: 2
    })

    const { mutateCheckpointPrefs, loadCheckpointPrefs } = await import(
      '../main/datasets/checkpointPrefs'
    )

    // Simulate collectCheckpoints holding a stale in-memory prefs (loaded before untick),
    // then saving only validationPreviews via mutate — keep must survive from disk.
    const stalePreviewSnap = {
      lora_000000250: {
        'Set 1': 'Set 1/lora_000000250.jpg',
        'Set 2': 'Set 2/lora_000000250.jpg'
      }
    }

    let releaseKeep!: () => void
    const keepGate = new Promise<void>((resolve) => {
      releaseKeep = resolve
    })

    const previewWrite = mutateCheckpointPrefs(datasetFolder, async (latest) => {
      await keepGate
      latest.validationPreviews = stalePreviewSnap
    })

    // Concurrent keep toggle (queued behind / interleaved with preview write).
    const keepWrite = mutateCheckpointPrefs(datasetFolder, (latest) => {
      latest.keepInComfy['lora_000000500'] = false
    })

    releaseKeep()
    await Promise.all([previewWrite, keepWrite])

    const next = await loadCheckpointPrefs(datasetFolder)
    expect(isKeepInComfy(next, 'lora_000000250')).toBe(false)
    expect(isKeepInComfy(next, 'lora_000000500')).toBe(false)
    expect(next.validationPreviews['lora_000000250']?.['Set 2']).toBe(
      'Set 2/lora_000000250.jpg'
    )
  })

  it('serializes writers so a full stale overwrite cannot win after keep toggle', async () => {
    const prefs = emptyCheckpointPrefs()
    await atomicWriteJson(join(datasetFolder, 'output', 'checkpoint-prefs.json'), {
      ...prefs,
      version: 2
    })

    const { mutateCheckpointPrefs, loadCheckpointPrefs } = await import(
      '../main/datasets/checkpointPrefs'
    )

    // Old bug: load → long work → saveCheckpointPrefs(stale). Emulate with mutate
    // that only updates previews after keep was set on disk.
    await mutateCheckpointPrefs(datasetFolder, (latest) => {
      latest.keepInComfy['stem_a'] = false
    })

    await mutateCheckpointPrefs(datasetFolder, (latest) => {
      latest.validationPreviews = {
        stem_a: { 'Set 1': 'Set 1/stem_a.jpg', 'Set 2': 'Set 2/stem_a.jpg' }
      }
    })

    const next = await loadCheckpointPrefs(datasetFolder)
    expect(isKeepInComfy(next, 'stem_a')).toBe(false)
    expect(Object.keys(next.validationPreviews['stem_a'] ?? {})).toEqual(['Set 1', 'Set 2'])
  })
})
