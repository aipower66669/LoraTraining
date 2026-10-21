import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Directory containing Windows safetensors shims (`sitecustomize.py`,
 * `train_bootstrap.py`, `lora_safetensors_patch.py`).
 * Packaged builds use `extraResources`; dev uses repo `resources/python-shims`.
 */
export function resolvePythonShimDir(): string | null {
  const candidates: string[] = []
  try {
    // electron-builder extraResources → `<install>/resources/python-shims`
    if (typeof process.resourcesPath === 'string' && process.resourcesPath) {
      candidates.push(join(process.resourcesPath, 'python-shims'))
    }
  } catch {
    /* ignore */
  }
  try {
    // Lazy require so vitest can import process-utils without a full Electron app.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron')
    if (app?.getAppPath) {
      candidates.push(join(app.getAppPath(), 'resources', 'python-shims'))
    }
  } catch {
    /* not in electron / app path unavailable */
  }
  // electron-vite: compiled main lives in `out/main`
  candidates.push(join(__dirname, '../../resources/python-shims'))
  candidates.push(join(process.cwd(), 'resources', 'python-shims'))

  for (const dir of candidates) {
    if (
      existsSync(join(dir, 'sitecustomize.py')) ||
      existsSync(join(dir, 'train_bootstrap.py'))
    ) {
      return dir
    }
  }
  return null
}

/** Absolute path to train_bootstrap.py, or null if shims are missing. */
export function resolveTrainBootstrap(): string | null {
  const dir = resolvePythonShimDir()
  if (!dir) return null
  const boot = join(dir, 'train_bootstrap.py')
  return existsSync(boot) ? boot : null
}
