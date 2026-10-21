import { describe, expect, it } from 'vitest'
import {
  isAiToolkitConfigured,
  isComfyConfigured,
  isJoyCaptionConfigured,
  toolConfigFlags
} from '@shared/tool-config'

describe('tool-config', () => {
  it('joyCaption requires working dir (script defaults to bundled captioner)', () => {
    expect(
      isJoyCaptionConfigured({
        workingDirectory: '',
        pythonExecutable: '',
        scriptPath: '',
        extraArgs: [],
        invocationMode: 'direct'
      })
    ).toBe(false)
    expect(
      isJoyCaptionConfigured({
        workingDirectory: 'F:\\AI\\JoyCaption',
        pythonExecutable: '',
        scriptPath: '',
        extraArgs: [],
        invocationMode: 'direct'
      })
    ).toBe(true)
  })

  it('comfy requires loras folder', () => {
    expect(
      isComfyConfigured({
        host: '127.0.0.1',
        port: 8188,
        secure: false,
        lorasFolder: '',
        validationLoraSubfolder: '!Testing',
        defaultValidationModel: '',
        launchCommand: '',
        wildcardLibraryFolder: '',
        comfyRoot: ''
      })
    ).toBe(false)
    expect(
      isComfyConfigured({
        host: '127.0.0.1',
        port: 8188,
        secure: false,
        lorasFolder: 'F:\\Comfy\\models\\loras',
        validationLoraSubfolder: '!Testing',
        defaultValidationModel: '',
        launchCommand: '',
        wildcardLibraryFolder: '',
        comfyRoot: ''
      })
    ).toBe(true)
  })

  it('AI Toolkit requires working dir', () => {
    expect(
      isAiToolkitConfigured({
        workingDirectory: '',
        pythonExecutable: '',
        runScript: 'run.py',
        extraArgs: []
      })
    ).toBe(false)
    expect(
      isAiToolkitConfigured({
        workingDirectory: 'F:\\AI\\ai-toolkit',
        pythonExecutable: '',
        runScript: 'run.py',
        extraArgs: []
      })
    ).toBe(true)
  })

  it('toolConfigFlags returns all false when settings missing', () => {
    expect(toolConfigFlags(null)).toEqual({
      joyCaption: false,
      aiToolkit: false,
      comfy: false
    })
  })
})
