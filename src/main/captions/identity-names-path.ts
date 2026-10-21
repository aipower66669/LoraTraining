import { existsSync } from 'node:fs'
import { join } from 'node:path'

const NAMES_FILE = 'names.txt'
const REFERENCE_DIR = 'reference'

/**
 * Resolve packaged/dev path to `reference/names.txt` (female given-name pool).
 */
export function resolveIdentityNamesPoolPath(): string | null {
  const candidates: string[] = []
  try {
    if (typeof process.resourcesPath === 'string' && process.resourcesPath) {
      // If ever copied to extraResources later
      candidates.push(join(process.resourcesPath, REFERENCE_DIR, NAMES_FILE))
      candidates.push(join(process.resourcesPath, NAMES_FILE))
    }
  } catch {
    /* ignore */
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron')
    if (app?.getAppPath) {
      const root = app.getAppPath()
      candidates.push(join(root, REFERENCE_DIR, NAMES_FILE))
      candidates.push(join(root, '..', REFERENCE_DIR, NAMES_FILE))
    }
  } catch {
    /* not in electron */
  }
  candidates.push(join(__dirname, '../../reference', NAMES_FILE))
  candidates.push(join(process.cwd(), REFERENCE_DIR, NAMES_FILE))

  for (const path of candidates) {
    if (existsSync(path)) return path
  }
  return null
}
