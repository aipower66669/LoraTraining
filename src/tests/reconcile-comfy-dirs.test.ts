import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyCheckpointPrefs } from '@shared/checkpoint-prefs'
import { atomicWriteJson } from '../main/security/atomic-write'

const tempDirs: string[] = []
let lorasRoot = ''
let datasetFolder = ''

async function freshTemp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

beforeEach(async () => {
  vi.resetModules()
  lorasRoot = await freshTemp('lora-comfy-')
  datasetFolder = await freshTemp('lora-ds-')
  await mkdir(join(datasetFolder, 'output'), { recursive: true })
  vi.doMock('../main/settings/store', () => ({
    loadSettings: async () => ({
      comfy: {
        lorasFolder: lorasRoot,
        validationLoraSubfolder: '!Testing'
      }
    })
  }))
})

afterEach(async () => {
  vi.doUnmock('../main/settings/store')
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

describe('reconcileStagedComfyDirs', () => {
  it('clears stale !Testing path when the file is gone', async () => {
    const prefs = emptyCheckpointPrefs()
    prefs.comfyRelativeDir['Styles_FlatLines_000001250'] = '!Testing'
    await atomicWriteJson(join(datasetFolder, 'output', 'checkpoint-prefs.json'), {
      ...prefs,
      version: 2
    })

    const { reconcileStagedComfyDirs } = await import('../main/datasets/checkpointPrefs')
    const healed = await reconcileStagedComfyDirs({
      datasetFolder,
      fileNames: ['Styles_FlatLines_000001250.safetensors']
    })
    expect(healed.get('Styles_FlatLines_000001250')).toBeNull()

    const { loadCheckpointPrefs } = await import('../main/datasets/checkpointPrefs')
    const next = await loadCheckpointPrefs(datasetFolder)
    expect(next.comfyRelativeDir['Styles_FlatLines_000001250']).toBeUndefined()
  })

  it('updates prefs when the file was moved to another subfolder', async () => {
    const prefs = emptyCheckpointPrefs()
    prefs.comfyRelativeDir['model_a'] = '!Testing'
    await atomicWriteJson(join(datasetFolder, 'output', 'checkpoint-prefs.json'), {
      ...prefs,
      version: 2
    })
    await mkdir(join(lorasRoot, 'Characters', 'Foo'), { recursive: true })
    await writeFile(join(lorasRoot, 'Characters', 'Foo', 'model_a.safetensors'), 'x', 'utf8')

    const { reconcileStagedComfyDirs, loadCheckpointPrefs } = await import(
      '../main/datasets/checkpointPrefs'
    )
    const healed = await reconcileStagedComfyDirs({
      datasetFolder,
      fileNames: ['model_a.safetensors']
    })
    expect(healed.get('model_a')).toBe('Characters/Foo')
    const next = await loadCheckpointPrefs(datasetFolder)
    expect(next.comfyRelativeDir['model_a']).toBe('Characters/Foo')
  })

  it('rediscovers a keep-in-Comfy file that lost its path (no delete-then-rehash)', async () => {
    const prefs = emptyCheckpointPrefs()
    // Path was cleared earlier; keep still default-true (stem absent from keepInComfy).
    await atomicWriteJson(join(datasetFolder, 'output', 'checkpoint-prefs.json'), {
      ...prefs,
      version: 2
    })
    await mkdir(join(lorasRoot, 'Styles', 'Bar'), { recursive: true })
    await writeFile(join(lorasRoot, 'Styles', 'Bar', 'lost_path.safetensors'), 'x', 'utf8')

    const { reconcileStagedComfyDirs, loadCheckpointPrefs } = await import(
      '../main/datasets/checkpointPrefs'
    )
    const healed = await reconcileStagedComfyDirs({
      datasetFolder,
      fileNames: ['lost_path.safetensors']
    })
    expect(healed.get('lost_path')).toBe('Styles/Bar')
    const next = await loadCheckpointPrefs(datasetFolder)
    expect(next.comfyRelativeDir['lost_path']).toBe('Styles/Bar')
    expect(next.keepInComfy['lost_path']).toBeUndefined()
  })

  it('does not scan excluded checkpoints with no tracked path', async () => {
    const prefs = emptyCheckpointPrefs()
    prefs.keepInComfy['skip_me'] = false
    await atomicWriteJson(join(datasetFolder, 'output', 'checkpoint-prefs.json'), {
      ...prefs,
      version: 2
    })
    await mkdir(join(lorasRoot, 'Elsewhere'), { recursive: true })
    await writeFile(join(lorasRoot, 'Elsewhere', 'skip_me.safetensors'), 'x', 'utf8')

    const { reconcileStagedComfyDirs, loadCheckpointPrefs } = await import(
      '../main/datasets/checkpointPrefs'
    )
    const healed = await reconcileStagedComfyDirs({
      datasetFolder,
      fileNames: ['skip_me.safetensors']
    })
    expect(healed.get('skip_me')).toBeNull()
    const next = await loadCheckpointPrefs(datasetFolder)
    expect(next.comfyRelativeDir['skip_me']).toBeUndefined()
  })

  it('keeps the path when the file is still at the recorded location', async () => {
    const prefs = emptyCheckpointPrefs()
    prefs.comfyRelativeDir['keep_me'] = '!Testing'
    await atomicWriteJson(join(datasetFolder, 'output', 'checkpoint-prefs.json'), {
      ...prefs,
      version: 2
    })
    await mkdir(join(lorasRoot, '!Testing'), { recursive: true })
    await writeFile(join(lorasRoot, '!Testing', 'keep_me.safetensors'), 'x', 'utf8')

    const { reconcileStagedComfyDirs } = await import('../main/datasets/checkpointPrefs')
    const healed = await reconcileStagedComfyDirs({
      datasetFolder,
      fileNames: ['keep_me.safetensors']
    })
    expect(healed.get('keep_me')).toBe('!Testing')
  })
})

describe('setCheckpointKeepInComfy copy-on-tick', () => {
  it('copies into Val. LoRA when missing anywhere under models/loras', async () => {
    await mkdir(join(datasetFolder, 'output'), { recursive: true })
    await writeFile(
      join(datasetFolder, 'output', 'job_000000100.safetensors'),
      'checkpoint-bytes',
      'utf8'
    )

    const { setCheckpointKeepInComfy } = await import('../main/datasets/checkpointPrefs')
    const result = await setCheckpointKeepInComfy({
      datasetFolder,
      fileName: 'job_000000100.safetensors',
      keepInComfy: true,
      relativePath: 'job_000000100.safetensors'
    })
    expect(result.copiedToComfy).toBe(true)
    expect(result.comfyRelativeDir).toBe('!Testing')
    expect(result.rediscovered).toBe(false)

    const { access } = await import('node:fs/promises')
    const { constants } = await import('node:fs')
    await access(join(lorasRoot, '!Testing', 'job_000000100.safetensors'), constants.F_OK)
  })

  it('does not copy when the file already exists elsewhere under loras', async () => {
    await mkdir(join(datasetFolder, 'output'), { recursive: true })
    await writeFile(join(datasetFolder, 'output', 'job_000000200.safetensors'), 'src', 'utf8')
    await mkdir(join(lorasRoot, 'Characters'), { recursive: true })
    await writeFile(join(lorasRoot, 'Characters', 'job_000000200.safetensors'), 'staged', 'utf8')

    const { setCheckpointKeepInComfy } = await import('../main/datasets/checkpointPrefs')
    const result = await setCheckpointKeepInComfy({
      datasetFolder,
      fileName: 'job_000000200.safetensors',
      keepInComfy: true,
      relativePath: 'job_000000200.safetensors'
    })
    expect(result.copiedToComfy).toBe(false)
    expect(result.comfyRelativeDir).toBe('Characters')
    expect(result.rediscovered).toBe(true)
  })

  it('copies into the same folder as sibling checkpoints (not !Testing)', async () => {
    await mkdir(join(datasetFolder, 'output'), { recursive: true })
    await writeFile(join(datasetFolder, 'output', 'a_000001000.safetensors'), 'a', 'utf8')
    await writeFile(join(datasetFolder, 'output', 'a_000002000.safetensors'), 'b', 'utf8')
    await mkdir(join(lorasRoot, 'Styles'), { recursive: true })
    await writeFile(join(lorasRoot, 'Styles', 'a_000001000.safetensors'), 'staged', 'utf8')

    const prefs = emptyCheckpointPrefs()
    prefs.comfyRelativeDir['a_000001000'] = 'Styles'
    await atomicWriteJson(join(datasetFolder, 'output', 'checkpoint-prefs.json'), {
      ...prefs,
      version: 2
    })

    const { setCheckpointKeepInComfy } = await import('../main/datasets/checkpointPrefs')
    const result = await setCheckpointKeepInComfy({
      datasetFolder,
      fileName: 'a_000002000.safetensors',
      keepInComfy: true,
      relativePath: 'a_000002000.safetensors'
    })
    expect(result.copiedToComfy).toBe(true)
    expect(result.comfyRelativeDir).toBe('Styles')

    const { access } = await import('node:fs/promises')
    const { constants } = await import('node:fs')
    await access(join(lorasRoot, 'Styles', 'a_000002000.safetensors'), constants.F_OK)
  })
})
