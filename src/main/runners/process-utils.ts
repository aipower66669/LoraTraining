import { spawn } from 'node:child_process'
import { delimiter } from 'node:path'
import { constants, platform, setPriority } from 'node:os'
import { resolvePythonShimDir } from './python-shim-path'

/**
 * Env for spawned Python tools. Forces UTF-8 stdio so Windows cp1252/charmap
 * does not crash when JoyCaption (etc.) prints emoji or other non-ASCII.
 * On Windows, prepends `resources/python-shims` so sitecustomize patches
 * safetensors away from mmap (OSError 1455 / commit-charge exhaustion).
 */
export function pythonChildEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...extra,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1'
  }
  if (platform() === 'win32') {
    const shimDir = resolvePythonShimDir()
    if (shimDir) {
      const prev = env.PYTHONPATH?.trim()
      env.PYTHONPATH = prev ? `${shimDir}${delimiter}${prev}` : shimDir
    }
  }
  return env
}

/**
 * Raise a child to High priority (best-effort). Prefer
 * `boostWindowsProcessTree` for training — that also clears Win11 EcoQoS on the tree.
 */
export function boostChildPriority(pid: number): void {
  setPriority(pid, constants.priority.PRIORITY_HIGH)
}

export function killProcessTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (platform() === 'win32') {
      const child = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
      child.on('exit', () => resolve())
      child.on('error', () => resolve())
    } else {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          /* ignore */
        }
      }
      resolve()
    }
  })
}
