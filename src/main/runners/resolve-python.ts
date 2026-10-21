import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { platform } from 'node:os'
import { spawn } from 'node:child_process'

async function exists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Relative activate.bat under a tool working directory (for `cmd /c call …`).
 * Prefers project-local `venv\Scripts\activate.bat`, then
 * `Scripts\activate.bat` when the work dir itself is a venv.
 */
export async function resolveVenvActivateBat(
  workingDirectory: string
): Promise<{ absolute: string; relativeCall: string }> {
  const candidates =
    platform() === 'win32'
      ? [
          { abs: join(workingDirectory, 'venv', 'Scripts', 'activate.bat'), rel: 'venv\\Scripts\\activate.bat' },
          { abs: join(workingDirectory, 'Scripts', 'activate.bat'), rel: 'Scripts\\activate.bat' }
        ]
      : [
          { abs: join(workingDirectory, 'venv', 'bin', 'activate'), rel: 'venv/bin/activate' },
          { abs: join(workingDirectory, 'bin', 'activate'), rel: 'bin/activate' }
        ]
  for (const c of candidates) {
    if (await exists(c.abs)) {
      return { absolute: c.abs, relativeCall: c.rel }
    }
  }
  throw new Error(
    `No venv activate script under ${workingDirectory} (tried venv\\Scripts\\activate.bat and Scripts\\activate.bat)`
  )
}

/** Quote one argument for `cmd.exe /c` (double embedded quotes; skip if plain). */
export function quoteCmdArg(arg: string): string {
  if (arg.length === 0) return '""'
  if (!/[ \t"&<>|^%]/.test(arg)) return arg
  return `"${arg.replace(/"/g, '""')}"`
}

/**
 * Prefer a cwd-relative script path for cmd+venv (avoids Windows treating a
 * quoted absolute path as relative and prepending cwd →
 * `F:\work\"F:\work\script.py"`).
 */
export function scriptArgForCmd(scriptAbsolute: string, workingDirectory: string): string {
  const rel = relative(workingDirectory, scriptAbsolute)
  const useRel =
    rel.length > 0 &&
    !isAbsolute(rel) &&
    !rel.startsWith('..') &&
    !rel.startsWith(`..${'\\'}`) &&
    !rel.startsWith('../')
  const pathForCmd = (useRel ? rel : scriptAbsolute).replace(/\//g, '\\')
  return quoteCmdArg(pathForCmd)
}

/**
 * `call venv\Scripts\activate.bat && python <script> <args…>` for cmd mode.
 * Script is relative to `workingDirectory` when possible.
 */
export function buildCmdVenvPythonCommand(opts: {
  activateRelativeCall: string
  scriptAbsolute: string
  workingDirectory: string
  scriptArgs: string[]
}): string {
  const script = scriptArgForCmd(opts.scriptAbsolute, opts.workingDirectory)
  const args = opts.scriptArgs.map(quoteCmdArg).join(' ')
  return `call ${opts.activateRelativeCall} && python ${script}${args ? ` ${args}` : ''}`
}

/**
 * Resolve a Python interpreter:
 * 1. Explicit path if set and present
 * 2. `{workingDirectory}/venv/Scripts/python.exe` or `Scripts/python.exe` (Windows), or `bin/python`
 * 3. `python` / `py` found on PATH
 */
export async function resolvePythonExecutable(
  explicit: string | undefined,
  workingDirectory?: string
): Promise<{ exe: string; source: 'explicit' | 'venv' | 'path' }> {
  const trimmed = explicit?.trim()
  if (trimmed) {
    if (await exists(trimmed)) {
      return { exe: trimmed, source: 'explicit' }
    }
    // Still try spawning — may be a PATH command name like "python"
    if (!isAbsolute(trimmed) && !trimmed.includes('/') && !trimmed.includes('\\')) {
      return { exe: trimmed, source: 'path' }
    }
    throw new Error(`Python executable not found: ${trimmed}`)
  }

  if (workingDirectory) {
    const candidates =
      platform() === 'win32'
        ? [
            join(workingDirectory, 'venv', 'Scripts', 'python.exe'),
            join(workingDirectory, 'Scripts', 'python.exe'),
            join(workingDirectory, 'python.exe')
          ]
        : [
            join(workingDirectory, 'venv', 'bin', 'python'),
            join(workingDirectory, 'bin', 'python'),
            join(workingDirectory, 'python')
          ]
    for (const c of candidates) {
      if (await exists(c)) {
        return { exe: c, source: 'venv' }
      }
    }
  }

  const fromPath = await findPythonOnPath()
  if (fromPath) {
    return { exe: fromPath, source: 'path' }
  }

  throw new Error(
    'No Python found. Set Python executable, or put python on PATH, or use a venv working directory.'
  )
}

function findPythonOnPath(): Promise<string | null> {
  const candidates = platform() === 'win32' ? ['python', 'py'] : ['python3', 'python']
  return (async () => {
    for (const cmd of candidates) {
      const ok = await canRunPython(cmd)
      if (ok) return cmd
    }
    return null
  })()
}

function canRunPython(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd, ['-V'], {
      windowsHide: true,
      shell: false,
      stdio: 'ignore'
    })
    child.on('error', () => resolve(false))
    child.on('exit', (code) => resolve(code === 0))
  })
}

export function resolveScriptPath(scriptPath: string, workingDirectory: string): string {
  if (!scriptPath.trim()) {
    throw new Error('Script path is required')
  }
  return isAbsolute(scriptPath) ? scriptPath : join(workingDirectory, scriptPath)
}
