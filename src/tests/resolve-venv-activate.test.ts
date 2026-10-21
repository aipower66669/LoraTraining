import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildCmdVenvPythonCommand,
  quoteCmdArg,
  resolveVenvActivateBat,
  scriptArgForCmd
} from '../main/runners/resolve-python'

describe('resolveVenvActivateBat', () => {
  it('prefers venv\\Scripts\\activate.bat under the work dir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lora-venv-'))
    try {
      await mkdir(join(root, 'venv', 'Scripts'), { recursive: true })
      await writeFile(join(root, 'venv', 'Scripts', 'activate.bat'), '@echo off\n', 'utf8')
      const resolved = await resolveVenvActivateBat(root)
      expect(resolved.relativeCall.replace(/\//g, '\\')).toBe('venv\\Scripts\\activate.bat')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('falls back to Scripts\\activate.bat when work dir is the venv', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lora-venv-'))
    try {
      await mkdir(join(root, 'Scripts'), { recursive: true })
      await writeFile(join(root, 'Scripts', 'activate.bat'), '@echo off\n', 'utf8')
      const resolved = await resolveVenvActivateBat(root)
      expect(resolved.relativeCall.replace(/\//g, '\\')).toBe('Scripts\\activate.bat')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('cmd script quoting', () => {
  it('uses a relative script path under the work dir (no absolute quotes)', () => {
    const cwd = 'F:\\AI\\joy_env'
    const script = 'F:\\AI\\joy_env\\caption.py'
    expect(scriptArgForCmd(script, cwd)).toBe('caption.py')
    const cmd = buildCmdVenvPythonCommand({
      activateRelativeCall: 'venv\\Scripts\\activate.bat',
      scriptAbsolute: script,
      workingDirectory: cwd,
      scriptArgs: ['F:\\ds\\a.jpg', 'F:\\tmp\\out']
    })
    expect(cmd).toBe(
      'call venv\\Scripts\\activate.bat && python caption.py F:\\ds\\a.jpg F:\\tmp\\out'
    )
    expect(cmd).not.toContain('"F:\\AI\\joy_env\\caption.py"')
  })

  it('quotes args that contain spaces', () => {
    expect(quoteCmdArg('F:\\My Dataset\\a.jpg')).toBe('"F:\\My Dataset\\a.jpg"')
  })
})
