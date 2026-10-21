import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * settings/store.ts calls `app.getPath('userData')` for the AppData root. Mock
 * `electron` so these tests can run under plain Vitest/node without a real
 * Electron process, pointing "AppData" at a fresh temp dir per test.
 */
let appDataDir = ''
const tempDirs: string[] = []

async function freshTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

beforeEach(async () => {
  vi.resetModules()
  appDataDir = await freshTempDir('lora-appdata-')
  vi.doMock('electron', () => ({
    app: { getPath: () => appDataDir }
  }))
})

afterEach(async () => {
  vi.doUnmock('electron')
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('settings store: AppData pointer vs. library settings split', () => {
  it('fresh install has no library root, seeds an empty AppData pointer, writes nothing to a library', async () => {
    const store = await import('../main/settings/store')
    const settings = await store.loadSettings()

    expect(settings.libraryRoot).toBe('')
    expect(settings.tools.aiToolkit.pythonExecutable).toBe('')
    expect(settings.lastValidationPrompt).toBe('')
    expect(settings.lastUpscaleConfig).toEqual({
      prompt: '',
      seed: 1,
      model: '',
      denoise: 0.5,
      styleIndex: 0,
      maxSize: 1600
    })
    expect(settings.lastDiversifyContextConfig).toEqual({
      prompt: '',
      seed: 0,
      count: 1
    })
    expect(settings.lastDiversifyExpressionConfig).toEqual({
      prompt: '',
      seed: 0,
      count: 1
    })

    const pointer = JSON.parse(await readFile(join(appDataDir, 'app-config.json'), 'utf8'))
    expect(pointer).toEqual({ version: 1, libraryRoot: '' })
  })

  it('setting a library root writes settings.json under the library, not AppData', async () => {
    const store = await import('../main/settings/store')
    const libraryRoot = await freshTempDir('lora-library-')

    await store.patchSettings({ libraryRoot, lastValidationPrompt: 'a private prompt' })

    const pointer = JSON.parse(await readFile(join(appDataDir, 'app-config.json'), 'utf8'))
    expect(pointer).toEqual({ version: 1, libraryRoot })

    const library = JSON.parse(await readFile(join(libraryRoot, 'settings.json'), 'utf8'))
    expect(library.lastValidationPrompt).toBe('a private prompt')

    // The sensitive field must never land in AppData.
    await expect(readFile(join(appDataDir, 'settings.json'), 'utf8')).rejects.toThrow()
  })

  it('switching libraryRoot loads the new library\u2019s own settings instead of carrying over the old one', async () => {
    const store = await import('../main/settings/store')
    const libraryA = await freshTempDir('lora-library-a-')
    const libraryB = await freshTempDir('lora-library-b-')

    await store.patchSettings({ libraryRoot: libraryA, lastValidationPrompt: 'prompt A' })
    const afterSwitch = await store.patchSettings({ libraryRoot: libraryB })

    expect(afterSwitch.libraryRoot).toBe(libraryB)
    expect(afterSwitch.lastValidationPrompt).toBe('')

    const libraryBSettings = JSON.parse(await readFile(join(libraryB, 'settings.json'), 'utf8'))
    expect(libraryBSettings.lastValidationPrompt).toBe('')

    // Library A is untouched by the switch — it keeps its own settings.
    const libraryASettings = JSON.parse(await readFile(join(libraryA, 'settings.json'), 'utf8'))
    expect(libraryASettings.lastValidationPrompt).toBe('prompt A')
  })

  it('auto-migrates a legacy monolithic AppData settings.json (+ comfy-workflow.json) into the library on load', async () => {
    const libraryRoot = await freshTempDir('lora-library-legacy-')
    await writeFile(
      join(appDataDir, 'settings.json'),
      JSON.stringify({
        version: 1,
        libraryRoot,
        lastValidationPrompt: 'legacy secret',
        recentDatasetIds: ['ds1'],
        tools: { aiToolkit: { pythonExecutable: 'C:/legacy/python.exe' } }
      }),
      'utf8'
    )
    await writeFile(
      join(appDataDir, 'comfy-workflow.json'),
      JSON.stringify({ version: 1, savedAt: new Date().toISOString(), workflow: {} }),
      'utf8'
    )

    const store = await import('../main/settings/store')
    const settings = await store.loadSettings()

    expect(settings.libraryRoot).toBe(libraryRoot)
    expect(settings.lastValidationPrompt).toBe('legacy secret')
    expect(settings.recentDatasetIds).toEqual(['ds1'])
    expect(settings.tools.aiToolkit.pythonExecutable).toBe('C:/legacy/python.exe')

    const librarySettings = JSON.parse(await readFile(join(libraryRoot, 'settings.json'), 'utf8'))
    expect(librarySettings.lastValidationPrompt).toBe('legacy secret')

    const libraryWorkflow = JSON.parse(
      await readFile(join(libraryRoot, 'comfy-workflow-validation.json'), 'utf8')
    )
    expect(libraryWorkflow.version).toBe(1)

    const pointer = JSON.parse(await readFile(join(appDataDir, 'app-config.json'), 'utf8'))
    expect(pointer).toEqual({ version: 1, libraryRoot })

    await expect(readFile(join(appDataDir, 'settings.json'), 'utf8')).rejects.toThrow()
    await expect(readFile(join(appDataDir, 'comfy-workflow.json'), 'utf8')).rejects.toThrow()
  })

  it('re-running load after migration is idempotent (does not re-migrate or duplicate)', async () => {
    const libraryRoot = await freshTempDir('lora-library-idempotent-')
    await writeFile(
      join(appDataDir, 'settings.json'),
      JSON.stringify({ version: 1, libraryRoot, lastValidationPrompt: 'legacy secret' }),
      'utf8'
    )

    const store = await import('../main/settings/store')
    const first = await store.loadSettings()
    expect(first.lastValidationPrompt).toBe('legacy secret')

    // Simulate a second app launch against the same on-disk state.
    vi.resetModules()
    vi.doMock('electron', () => ({ app: { getPath: () => appDataDir } }))
    const store2 = await import('../main/settings/store')
    const second = await store2.loadSettings()

    expect(second.libraryRoot).toBe(libraryRoot)
    expect(second.lastValidationPrompt).toBe('legacy secret')
  })
})
