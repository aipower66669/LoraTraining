import { existsSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import { BUNDLED_JOYCAPTION_SCRIPT } from '@shared/joycaption'

const BUNDLED_DIR = 'joycaption'

/** Directory with the shipped captioner script, or null if missing. */
export function resolveBundledJoyCaptionDir(): string | null {
  const candidates: string[] = []
  try {
    if (typeof process.resourcesPath === 'string' && process.resourcesPath) {
      candidates.push(join(process.resourcesPath, BUNDLED_DIR))
    }
  } catch {
    /* ignore */
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron')
    if (app?.getAppPath) {
      candidates.push(join(app.getAppPath(), 'resources', BUNDLED_DIR))
      candidates.push(join(app.getAppPath(), BUNDLED_DIR))
    }
  } catch {
    /* not in electron */
  }
  candidates.push(join(__dirname, '../../resources', BUNDLED_DIR))
  candidates.push(join(process.cwd(), 'resources', BUNDLED_DIR))

  for (const dir of candidates) {
    if (existsSync(join(dir, BUNDLED_JOYCAPTION_SCRIPT))) {
      return dir
    }
  }
  return null
}

/**
 * Resolve JoyCaption script path.
 * - Absolute path → as-is
 * - Bare filename: prefer `{workDir}/{name}` if present, else bundled copy when available
 * - Relative with separators → under work dir
 */
export function resolveJoyCaptionScriptPath(
  scriptPath: string,
  workingDirectory: string
): string {
  const trimmed = scriptPath.trim() || BUNDLED_JOYCAPTION_SCRIPT
  if (isAbsolute(trimmed)) {
    return trimmed
  }

  const hasSep = trimmed.includes('/') || trimmed.includes('\\')
  if (!hasSep) {
    const inWork = workingDirectory.trim()
      ? join(workingDirectory.trim(), trimmed)
      : null
    if (inWork && existsSync(inWork)) {
      return inWork
    }
    const bundledDir = resolveBundledJoyCaptionDir()
    if (bundledDir) {
      const bundled = join(bundledDir, basename(trimmed))
      if (existsSync(bundled)) {
        return bundled
      }
    }
    if (inWork) return inWork
  }

  if (!workingDirectory.trim()) {
    throw new Error('JoyCaption working directory is required for a relative script path')
  }
  return join(workingDirectory.trim(), trimmed)
}
