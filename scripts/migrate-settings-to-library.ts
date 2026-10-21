/**
 * IN-PLACE migration: move the legacy monolithic AppData `settings.json`
 * (tool paths, Comfy config, default training config, recent IDs,
 * `lastValidationPrompt`) and `comfy-workflow.json` into the library root,
 * leaving AppData with only the pointer (`app-config.json: { libraryRoot }`)
 * and `window-state.json`.
 *
 * Idempotent: safe to re-run; no-ops once the library already has its own
 * `settings.json`. The app also performs this migration automatically on
 * startup (see `loadLibrarySettings` / `migrateLegacySettingsIntoLibrary` in
 * `src/main/settings/store.ts`) — this script is a manual, dry-run-able
 * fallback for inspection/CI, not the primary path.
 *
 * Usage: npm run migrate:settings
 *    or: npx tsx scripts/migrate-settings-to-library.ts [--dry-run]
 */
import { access, copyFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { LibrarySettingsSchema, createDefaultTrainingConfig } from '../src/shared/schemas/settings'
import {
  LIBRARY_SETTINGS_FILE,
  LIBRARY_VALIDATION_WORKFLOW_FILE
} from '../src/shared/library-paths'
import { appDataLoraTrainingRoot, resolveLibraryRoot } from './lib/library-root'

const DRY_RUN = process.argv.includes('--dry-run')

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function moveFileBestEffort(from: string, to: string): Promise<void> {
  try {
    await rename(from, to)
  } catch {
    await copyFile(from, to)
    await unlink(from).catch(() => undefined)
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function main(): Promise<void> {
  const root = await resolveLibraryRoot()
  const appDataRoot = appDataLoraTrainingRoot()
  const legacySettingsPath = join(appDataRoot, 'settings.json')
  const legacyWorkflowPath = join(appDataRoot, 'comfy-workflow.json')
  const appConfigPath = join(appDataRoot, 'app-config.json')
  const librarySettingsFilePath = join(root, LIBRARY_SETTINGS_FILE)
  const libraryWorkflowFilePath = join(root, LIBRARY_VALIDATION_WORKFLOW_FILE)

  console.log('Library root:', root)
  console.log('AppData:     ', appDataRoot)
  console.log('Dry run:     ', DRY_RUN)

  let migratedSettings = false
  let movedWorkflow = false
  let legacySettingsHandled = false

  if (await pathExists(librarySettingsFilePath)) {
    console.log(`[skip] Library already has ${LIBRARY_SETTINGS_FILE}.`)
  } else if (await pathExists(legacySettingsPath)) {
    const raw = await readFile(legacySettingsPath, 'utf8')
    const obj = JSON.parse(raw) as Record<string, unknown>
    const { libraryRoot: _libraryRoot, ...rest } = obj
    void _libraryRoot
    const library = LibrarySettingsSchema.parse({
      ...rest,
      defaultTrainingConfig: rest.defaultTrainingConfig ?? createDefaultTrainingConfig()
    })
    console.log(`[migrate] settings.json → ${librarySettingsFilePath}`)
    if (!DRY_RUN) {
      await mkdir(root, { recursive: true })
      await writeJson(librarySettingsFilePath, library)
    }
    migratedSettings = true
    legacySettingsHandled = true
  } else {
    console.log('[skip] No legacy AppData settings.json found.')
  }

  if (await pathExists(libraryWorkflowFilePath)) {
    console.log(`[skip] Library already has ${LIBRARY_VALIDATION_WORKFLOW_FILE}.`)
  } else if (await pathExists(legacyWorkflowPath)) {
    console.log(`[move] comfy-workflow.json → ${libraryWorkflowFilePath}`)
    if (!DRY_RUN) {
      await mkdir(root, { recursive: true })
      await moveFileBestEffort(legacyWorkflowPath, libraryWorkflowFilePath)
    }
    movedWorkflow = true
  } else {
    console.log('[skip] No legacy AppData comfy-workflow.json found.')
  }

  if (legacySettingsHandled || (await pathExists(legacySettingsPath))) {
    console.log(`[trim] AppData → pointer-only ${appConfigPath}`)
    if (!DRY_RUN) {
      await writeJson(appConfigPath, { version: 1, libraryRoot: root })
      await unlink(legacySettingsPath).catch(() => undefined)
    }
  }

  console.log('Done.', { migratedSettings, movedWorkflow, dryRun: DRY_RUN })
  if (!migratedSettings && !movedWorkflow) {
    console.log('Nothing to do — already migrated.')
  }
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
