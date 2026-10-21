/**
 * Resolve the live library root for in-place config migration scripts.
 *
 * Prefer AppData `app-config.json` (the post-split pointer file); fall back to the
 * legacy monolithic `settings.json` for installs that haven't migrated yet.
 * Optional LORA_LIBRARY_ROOT is for emergencies only.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

export function appDataLoraTrainingRoot(): string {
  const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
  return join(appData, 'lora-training')
}

/** Current AppData pointer file (post-split): `{ version, libraryRoot }` only. */
export function appConfigJsonPath(): string {
  return join(appDataLoraTrainingRoot(), 'app-config.json')
}

/** Legacy pre-split AppData file — used to bootstrap the very first migration run. */
export function settingsJsonPath(): string {
  return join(appDataLoraTrainingRoot(), 'settings.json')
}

function parseLibraryRoot(raw: string): string {
  const parsed: unknown = JSON.parse(raw)
  return parsed &&
    typeof parsed === 'object' &&
    'libraryRoot' in parsed &&
    typeof (parsed as { libraryRoot: unknown }).libraryRoot === 'string'
    ? (parsed as { libraryRoot: string }).libraryRoot.trim()
    : ''
}

/** Parse libraryRoot from AppData (app-config.json, falling back to legacy settings.json). Throws if missing/empty. */
export async function readLibraryRootFromAppData(): Promise<string> {
  for (const path of [appConfigJsonPath(), settingsJsonPath()]) {
    try {
      const root = parseLibraryRoot(await readFile(path, 'utf8'))
      if (root) return root
    } catch {
      /* try next candidate */
    }
  }
  throw new Error(
    `libraryRoot not found in ${appConfigJsonPath()} or ${settingsJsonPath()}. Set Settings → Library root first.`
  )
}

/**
 * libraryRoot for migrations: LORA_LIBRARY_ROOT (emergency) or AppData settings.
 */
export async function resolveLibraryRoot(): Promise<string> {
  const override = (process.env.LORA_LIBRARY_ROOT || '').trim()
  if (override) return override
  return readLibraryRootFromAppData()
}
