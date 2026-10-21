import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { shell } from 'electron'
import { appError } from '@shared/errors'
import { loadSettings } from '../settings/store'
import { logger } from '../logging'

/**
 * Start ComfyUI via the configured launch path, fully detached from this app
 * (same as double-clicking the .bat) so it survives Electron restarts.
 */
export async function launchComfyUi(): Promise<{ launched: true; command: string }> {
  const settings = await loadSettings()
  const command = settings.comfy.launchCommand.trim()
  if (!command) {
    throw appError('validation', 'ComfyUI launch command is not set', {
      remediation:
        'Set Settings → ComfyUI → Launch command to your portable launcher (e.g. run_nvidia_gpu.bat).'
    })
  }
  if (!existsSync(command)) {
    throw appError('validation', `ComfyUI launch command not found: ${command}`, {
      remediation: 'Fix the path in Settings → ComfyUI → Launch command.'
    })
  }

  // Prefer ShellExecute — not a child of Electron; survives app quit.
  const openErr = await shell.openPath(command)
  if (!openErr) {
    logger.info({ command }, 'ComfyUI launched via shell.openPath')
    return { launched: true, command }
  }

  logger.warn({ command, openErr }, 'shell.openPath failed; falling back to cmd start')
  if (process.platform === 'win32') {
    const child = spawn('cmd.exe', ['/c', 'start', '""', command], {
      detached: true,
      stdio: 'ignore',
      cwd: dirname(command),
      windowsHide: false
    })
    child.unref()
    return { launched: true, command }
  }

  const child = spawn(command, [], {
    detached: true,
    stdio: 'ignore',
    cwd: dirname(command),
    shell: true
  })
  child.unref()
  return { launched: true, command }
}
