import { describe, expect, it } from 'vitest'
import {
  SettingsSchema,
  buildSettingsExportFile,
  createDefaultTrainingConfig,
  parseSettingsExportFile,
  pickEditableSettingsSubset,
  SETTINGS_EXPORT_FORMAT
} from '@shared/schemas/settings'

function sampleSettings() {
  return SettingsSchema.parse({
    version: 1,
    libraryRoot: 'F:\\Libraries\\Lora',
    tools: {
      joyCaption: {
        workingDirectory: 'F:\\AI\\JoyCaption',
        pythonExecutable: 'F:\\AI\\JoyCaption\\python.exe',
        scriptPath: 'bundled',
        extraArgs: [],
        invocationMode: 'direct'
      },
      aiToolkit: {
        workingDirectory: 'F:\\AI\\AI-Toolkit',
        pythonExecutable: 'F:\\AI\\AI-Toolkit\\venv\\Scripts\\python.exe',
        runScript: 'run.py',
        extraArgs: []
      },
      photoshopExecutable: 'C:\\Program Files\\Adobe\\Photoshop.exe'
    },
    comfy: {
      host: '127.0.0.1',
      port: 8188,
      secure: false,
      lorasFolder: 'F:\\ComfyUI\\models\\loras',
      validationLoraSubfolder: '!Testing',
      defaultValidationModel: '',
      launchCommand: '',
      wildcardLibraryFolder: '',
      comfyRoot: 'F:\\ComfyUI'
    },
    queue: { allowConcurrentCaptioning: true, continueOnFailure: false },
    defaultTrainingConfig: createDefaultTrainingConfig(),
    recentDatasetIds: ['ds-should-not-export'],
    recentJobIds: ['job-should-not-export'],
    lastValidationPrompt: 'secret prompt',
    lastStressModels: ['model.safetensors'],
    lastWeightRange: { weightMin: 0.5, weightMax: 1.5, weightStep: 0.1 },
    lastImageScraperSource: 'google',
    lastUpscaleConfig: {
      prompt: 'upscale secret',
      seed: 9,
      model: 'x',
      denoise: 0.4,
      styleIndex: 1,
      maxSize: 1200
    },
    lastDiversifyContextConfig: {
      prompt: 'ctx',
      seed: 1,
      model: '',
      denoise: 0.5,
      styleIndex: 0,
      maxSize: 1600
    },
    lastDiversifyExpressionConfig: {
      prompt: 'expr',
      seed: 1,
      model: '',
      denoise: 0.5,
      styleIndex: 0,
      maxSize: 1600
    },
    updateCheckFolder: 'F:\\Sites\\LoraTraining\\release',
    imageVersionsEnabled: true,
    imageVersionsAdsMigratedAt: '2026-01-01T00:00:00.000Z'
  })
}

describe('settings export subset', () => {
  it('picks Settings-page fields only', () => {
    const subset = pickEditableSettingsSubset(sampleSettings())
    expect(subset.libraryRoot).toBe('F:\\Libraries\\Lora')
    expect(subset.tools.aiToolkit.workingDirectory).toBe('F:\\AI\\AI-Toolkit')
    expect(subset.comfy.comfyRoot).toBe('F:\\ComfyUI')
    expect(subset.queue).toEqual({
      allowConcurrentCaptioning: true,
      continueOnFailure: false
    })
    expect(subset.updateCheckFolder).toBe('F:\\Sites\\LoraTraining\\release')
    expect(subset.imageVersionsEnabled).toBe(true)
    expect(subset.defaultTrainingConfig.model.arch).toBe('krea2')
    expect(subset).not.toHaveProperty('recentDatasetIds')
    expect(subset).not.toHaveProperty('lastValidationPrompt')
    expect(subset).not.toHaveProperty('lastStressModels')
    expect(subset).not.toHaveProperty('imageVersionsAdsMigratedAt')
  })

  it('round-trips through export file schema', () => {
    const doc = buildSettingsExportFile(sampleSettings(), '2026-09-07T00:00:00.000Z')
    expect(doc.format).toBe(SETTINGS_EXPORT_FORMAT)
    expect(doc.version).toBe(1)
    expect(doc.exportedAt).toBe('2026-09-07T00:00:00.000Z')
    const again = parseSettingsExportFile(JSON.parse(JSON.stringify(doc)))
    expect(again.settings.tools.joyCaption.workingDirectory).toBe('F:\\AI\\JoyCaption')
    expect(again.settings.queue.continueOnFailure).toBe(false)
    expect(again.settings.imageVersionsEnabled).toBe(true)
  })

  it('defaults NTFS image versions off for existing settings and exports', () => {
    const settings = sampleSettings()
    const legacy = JSON.parse(JSON.stringify(settings)) as Record<string, unknown>
    delete legacy.imageVersionsEnabled
    expect(SettingsSchema.parse(legacy).imageVersionsEnabled).toBe(false)

    const exported = buildSettingsExportFile(
      SettingsSchema.parse(legacy),
      '2026-09-07T00:00:00.000Z'
    )
    expect(exported.settings.imageVersionsEnabled).toBe(false)

    const legacyExport = JSON.parse(JSON.stringify(exported)) as {
      settings: Record<string, unknown>
    }
    delete legacyExport.settings.imageVersionsEnabled
    expect(parseSettingsExportFile(legacyExport).settings.imageVersionsEnabled).toBe(false)
  })

  it('rejects garbage and wrong format', () => {
    expect(() => parseSettingsExportFile({})).toThrow()
    expect(() =>
      parseSettingsExportFile({
        format: 'something-else',
        version: 1,
        exportedAt: 'x',
        settings: {}
      })
    ).toThrow()
    expect(() =>
      parseSettingsExportFile({
        format: SETTINGS_EXPORT_FORMAT,
        version: 99,
        exportedAt: 'x',
        settings: pickEditableSettingsSubset(sampleSettings())
      })
    ).toThrow()
  })
})
