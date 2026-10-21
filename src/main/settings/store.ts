import { app } from 'electron'
import { access, cp, mkdir, readdir, readFile, rename, rm, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import {
  AppPointerSchema,
  LibrarySettingsSchema,
  SettingsPatchSchema,
  SettingsSchema,
  createDefaultTrainingConfig,
  type AppPointer,
  type AppSettings,
  type LibrarySettings,
  type SettingsPatch
} from '@shared/schemas/settings'
import { TrainingConfigSchema } from '@shared/schemas/training-config'
import {
  libraryJobsDir,
  librarySettingsPath,
  libraryValidationWorkflowPath
} from '@shared/library-paths'
import { appError } from '@shared/errors'
import { atomicWriteJson } from '../security/atomic-write'
import { logger } from '../logging'

let cache: AppSettings | null = null
let libraryRootCache: string | null = null
let jobsDirReady: Promise<string> | null = null

/** Electron userData — the app pointer + window state only. Not the training library. */
export function getAppDataRoot(): string {
  return app.getPath('userData')
}

/** @deprecated Use getAppDataRoot() for AppData paths. */
export function getUserDataRoot(): string {
  return getAppDataRoot()
}

/**
 * AppData "pointer" file — the ONLY durable app-level state. Deliberately minimal
 * (just `libraryRoot`) so AppData never needs to be backed up: everything that
 * matters for restoring a workspace lives under the library instead.
 */
export function appConfigPath(): string {
  return join(getAppDataRoot(), 'app-config.json')
}

/** Legacy monolithic AppData settings.json (pre library-settings split). Read-only; used only to bootstrap/migrate. */
export function legacyAppDataSettingsPath(): string {
  return join(getAppDataRoot(), 'settings.json')
}

/** Legacy AppData jobs/ (pre library !Jobs). Used only for one-shot migrate. */
export function legacyAppDataJobsDir(): string {
  return join(getAppDataRoot(), 'jobs')
}

/**
 * Absolute library root (categories + datasets on disk).
 * Requires settings loaded (or setLibraryRootCache).
 */
export function getLibraryRoot(): string {
  const root = (libraryRootCache ?? cache?.libraryRoot ?? '').trim()
  if (!root) {
    throw appError('validation', 'Library root is not configured', {
      remediation: 'Set Settings → library root, or run migration and point libraryRoot at F:\\migration.'
    })
  }
  return root
}

export function tryGetLibraryRoot(): string | null {
  const root = (libraryRootCache ?? cache?.libraryRoot ?? '').trim()
  return root || null
}

export function setLibraryRootCache(root: string): void {
  libraryRootCache = root.trim() || null
  jobsDirReady = null
  void import('../jobs/store').then((m) => m.invalidateJobsCache()).catch(() => undefined)
}

/** Jobs live under `{libraryRoot}/!Jobs` (hidden). Requires libraryRoot. */
export function jobsDir(): string {
  return libraryJobsDir(getLibraryRoot())
}

async function setHiddenWindows(dir: string): Promise<void> {
  if (process.platform !== 'win32') return
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  try {
    await execFileAsync('attrib', ['+H', dir])
  } catch {
    /* best-effort */
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/** Copy any missing job folders from AppData into library !Jobs, then remove AppData jobs/. */
async function migrateJobsFromAppData(dest: string): Promise<void> {
  const src = legacyAppDataJobsDir()
  if (!(await pathExists(src))) return

  const srcEntries = await readdir(src, { withFileTypes: true }).catch(() => [])
  if (srcEntries.length === 0) {
    await rm(src, { recursive: true, force: true }).catch(() => undefined)
    return
  }

  const destExists = await pathExists(dest)
  const destEmpty = !destExists || (await readdir(dest)).length === 0
  if (destEmpty) {
    await mkdir(join(dest, '..'), { recursive: true })
    if (destExists) {
      await rm(dest, { recursive: true, force: true }).catch(() => undefined)
    }
    try {
      await rename(src, dest)
      logger.info({ dest }, 'Moved AppData jobs → library !Jobs')
      return
    } catch {
      /* fall through to copy */
    }
  }

  let moved = 0
  for (const ent of srcEntries) {
    if (!ent.isDirectory()) continue
    const from = join(src, ent.name)
    const to = join(dest, ent.name)
    if (await pathExists(to)) continue
    await cp(from, to, { recursive: true })
    moved++
  }
  await rm(src, { recursive: true, force: true }).catch((err) => {
    logger.warn({ err, src }, 'Could not remove legacy AppData jobs after migrate')
  })
  if (moved > 0) {
    logger.info({ dest, moved }, 'Migrated AppData jobs → library !Jobs')
  }
}

/** Ensure `{libraryRoot}/!Jobs` exists, is hidden on Windows, and AppData jobs are migrated. */
export async function ensureJobsDir(): Promise<string> {
  if (!tryGetLibraryRoot()) {
    throw appError('validation', 'Library root is not configured', {
      remediation: 'Set Settings → library root before using jobs.'
    })
  }
  if (!jobsDirReady) {
    jobsDirReady = (async () => {
      const dir = jobsDir()
      await mkdir(dir, { recursive: true })
      await migrateJobsFromAppData(dir).catch((err) => {
        logger.warn({ err }, 'AppData jobs migrate failed')
      })
      await mkdir(dir, { recursive: true })
      await setHiddenWindows(dir)
      return dir
    })()
  }
  return jobsDirReady
}

export async function ensureAppDataDirs(): Promise<void> {
  await mkdir(getAppDataRoot(), { recursive: true })
}

/** Ensure AppData + library jobs dir when libraryRoot is set. */
export async function ensureLibraryDirs(): Promise<void> {
  await ensureAppDataDirs()
  // Must load the AppData pointer before tryGetLibraryRoot() — otherwise startup
  // hydrate runs with an empty cache, locks an empty FIFO, and the queue looks wiped.
  await loadSettings()
  if (tryGetLibraryRoot()) {
    await ensureJobsDir().catch((err) => logger.warn({ err }, 'ensureJobsDir failed'))
  }
}

/** Legacy AppData datasets/ (pre-migration). Used only by migration tooling. */
export function legacyAppDataDatasetsDir(): string {
  return join(getAppDataRoot(), 'datasets')
}

function defaultLibrarySettings(): LibrarySettings {
  return LibrarySettingsSchema.parse({
    version: 1,
    defaultTrainingConfig: createDefaultTrainingConfig()
  })
}

async function saveAppPointer(pointer: AppPointer): Promise<void> {
  await atomicWriteJson(appConfigPath(), pointer)
}

/** Read the AppData pointer (libraryRoot only). Falls back to a legacy monolithic settings.json for bootstrap. */
async function loadAppPointer(): Promise<AppPointer> {
  await ensureAppDataDirs()
  try {
    const raw = await readFile(appConfigPath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return AppPointerSchema.parse(parsed && typeof parsed === 'object' ? parsed : {})
  } catch {
    // Pre-split installs: libraryRoot still lives in the old monolithic settings.json.
    // Read it (without treating the rest of the file as pointer data) so we can bootstrap;
    // the real migration/cleanup happens in migrateLegacySettingsIntoLibrary below.
    try {
      const raw = await readFile(legacyAppDataSettingsPath(), 'utf8')
      const parsed: unknown = JSON.parse(raw)
      const obj = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
      return AppPointerSchema.parse({ version: 1, libraryRoot: obj.libraryRoot ?? '' })
    } catch {
      // Truly fresh install (no pointer, no legacy file): seed an empty pointer so
      // app-config.json exists on disk, mirroring the old self-healing behavior.
      const fresh = AppPointerSchema.parse({ version: 1, libraryRoot: '' })
      await saveAppPointer(fresh).catch(() => undefined)
      return fresh
    }
  }
}

/** Move a file, falling back to copy+unlink across-device/permission failures. */
async function moveFileBestEffort(from: string, to: string): Promise<void> {
  try {
    await rename(from, to)
  } catch {
    await cp(from, to)
    await unlink(from).catch(() => undefined)
  }
}

/**
 * One-time, idempotent migration: move a legacy monolithic AppData settings.json
 * (and comfy-workflow.json, if present) into the library, then trim AppData down
 * to just the pointer. No-ops once the library already has its own settings.json.
 * Mirrors migrateJobsFromAppData above; runs automatically whenever the library
 * settings file is loaded (see loadLibrarySettings), so existing installs migrate
 * on next launch with no manual step. `scripts/migrate-settings-to-library.ts` is
 * the manual/dry-run-able equivalent for out-of-app inspection.
 */
async function migrateLegacySettingsIntoLibrary(root: string): Promise<LibrarySettings | null> {
  const dest = librarySettingsPath(root)
  if (await pathExists(dest)) return null

  const legacyPath = legacyAppDataSettingsPath()
  if (!(await pathExists(legacyPath))) return null

  let migrated: LibrarySettings
  try {
    const raw = await readFile(legacyPath, 'utf8')
    const obj = JSON.parse(raw) as Record<string, unknown>
    migrated = LibrarySettingsSchema.parse({
      ...obj,
      defaultTrainingConfig: obj.defaultTrainingConfig ?? createDefaultTrainingConfig()
    })
  } catch (err) {
    logger.warn(
      { err },
      'legacy AppData settings.json unreadable/invalid; seeding library defaults instead'
    )
    migrated = defaultLibrarySettings()
  }

  await mkdir(root, { recursive: true })
  await atomicWriteJson(dest, migrated)

  const legacyWorkflowPath = join(getAppDataRoot(), 'comfy-workflow.json')
  const destWorkflowPath = libraryValidationWorkflowPath(root)
  if ((await pathExists(legacyWorkflowPath)) && !(await pathExists(destWorkflowPath))) {
    await moveFileBestEffort(legacyWorkflowPath, destWorkflowPath).catch((err) => {
      logger.warn({ err }, 'failed to move comfy-workflow.json into library')
    })
  }

  await saveAppPointer(AppPointerSchema.parse({ version: 1, libraryRoot: root }))
  await unlink(legacyPath).catch((err) => {
    logger.warn({ err }, 'failed to remove legacy AppData settings.json after migration')
  })
  logger.info({ root }, 'Migrated AppData settings.json → library settings.json')
  return migrated
}

/** Load (or seed) `{libraryRoot}/settings.json`, migrating a legacy AppData file first if needed. */
async function loadLibrarySettings(root: string): Promise<LibrarySettings> {
  const migrated = await migrateLegacySettingsIntoLibrary(root)
  if (migrated) return migrated

  try {
    const raw = await readFile(librarySettingsPath(root), 'utf8')
    const obj = JSON.parse(raw) as Record<string, unknown>
    return LibrarySettingsSchema.parse({
      ...obj,
      defaultTrainingConfig: obj.defaultTrainingConfig ?? createDefaultTrainingConfig()
    })
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : ''
    if (code !== 'ENOENT') {
      logger.warn({ err, root }, 'library settings.json unreadable/invalid; seeding defaults')
    }
    const defaults = defaultLibrarySettings()
    await mkdir(root, { recursive: true })
    await atomicWriteJson(librarySettingsPath(root), defaults)
    return defaults
  }
}

export async function loadSettings(): Promise<AppSettings> {
  if (cache) return cache
  const pointer = await loadAppPointer()
  const root = pointer.libraryRoot.trim()
  libraryRootCache = root || null
  const library = root ? await loadLibrarySettings(root) : defaultLibrarySettings()
  cache = SettingsSchema.parse({ ...library, libraryRoot: root })
  return cache
}

export async function saveSettings(next: AppSettings): Promise<AppSettings> {
  const parsed = SettingsSchema.parse({
    ...next,
    queue: { allowConcurrentCaptioning: false }
  })
  const nextRoot = parsed.libraryRoot.trim()
  await saveAppPointer(AppPointerSchema.parse({ version: 1, libraryRoot: nextRoot }))

  const prevRoot = libraryRootCache
  libraryRootCache = nextRoot || null
  if (prevRoot !== libraryRootCache) {
    jobsDirReady = null
  }

  if (libraryRootCache) {
    const { libraryRoot: _libraryRoot, ...rest } = parsed
    void _libraryRoot
    const library = LibrarySettingsSchema.parse(rest)
    await mkdir(libraryRootCache, { recursive: true })
    await atomicWriteJson(librarySettingsPath(libraryRootCache), library)
  } else {
    logger.warn('Library root is not set — settings other than libraryRoot were not persisted to disk')
  }

  cache = parsed
  return parsed
}

/**
 * Re-point the app at a different library. Loads (or seeds) that library's OWN
 * settings.json before anything else is applied — the previous library's
 * in-memory settings are never carried over, since each library owns its settings.
 */
async function switchLibraryRoot(newRoot: string): Promise<AppSettings> {
  cache = null
  jobsDirReady = null
  libraryRootCache = newRoot || null
  void import('../jobs/store').then((m) => m.invalidateJobsCache()).catch(() => undefined)
  const library = newRoot ? await loadLibrarySettings(newRoot) : defaultLibrarySettings()
  const base = SettingsSchema.parse({ ...library, libraryRoot: newRoot })
  cache = base
  return base
}

function mergeSettingsPatch(base: AppSettings, p: SettingsPatch): AppSettings {
  return {
    ...base,
    ...p,
    libraryRoot: p.libraryRoot !== undefined ? p.libraryRoot.trim() : base.libraryRoot,
    tools: {
      joyCaption: { ...base.tools.joyCaption, ...p.tools?.joyCaption },
      aiToolkit: { ...base.tools.aiToolkit, ...p.tools?.aiToolkit },
      photoshopExecutable: p.tools?.photoshopExecutable ?? base.tools.photoshopExecutable
    },
    comfy: { ...base.comfy, ...p.comfy },
    queue: { ...base.queue, ...p.queue },
    lastUpscaleConfig: p.lastUpscaleConfig
      ? {
          ...base.lastUpscaleConfig,
          ...p.lastUpscaleConfig,
          styleIndex:
            p.lastUpscaleConfig.styleIndex !== undefined
              ? p.lastUpscaleConfig.styleIndex === 1
                ? 1
                : 0
              : base.lastUpscaleConfig.styleIndex
        }
      : base.lastUpscaleConfig,
    lastDiversifyContextConfig: p.lastDiversifyContextConfig
      ? { ...base.lastDiversifyContextConfig, ...p.lastDiversifyContextConfig }
      : base.lastDiversifyContextConfig,
    lastDiversifyExpressionConfig: p.lastDiversifyExpressionConfig
      ? { ...base.lastDiversifyExpressionConfig, ...p.lastDiversifyExpressionConfig }
      : base.lastDiversifyExpressionConfig,
    lastWeightRange: p.lastWeightRange
      ? { ...base.lastWeightRange, ...p.lastWeightRange }
      : base.lastWeightRange,
    updateCheckFolder:
      p.updateCheckFolder !== undefined ? p.updateCheckFolder.trim() : base.updateCheckFolder,
    defaultTrainingConfig: p.defaultTrainingConfig
      ? TrainingConfigSchema.parse({
          ...base.defaultTrainingConfig,
          ...p.defaultTrainingConfig,
          network: {
            ...base.defaultTrainingConfig.network,
            ...p.defaultTrainingConfig.network
          },
          save: { ...base.defaultTrainingConfig.save, ...p.defaultTrainingConfig.save },
          train: {
            ...base.defaultTrainingConfig.train,
            ...p.defaultTrainingConfig.train,
            optimizer_params: {
              ...base.defaultTrainingConfig.train.optimizer_params,
              ...p.defaultTrainingConfig.train?.optimizer_params
            },
            ema_config: {
              ...base.defaultTrainingConfig.train.ema_config,
              ...p.defaultTrainingConfig.train?.ema_config
            }
          },
          model: { ...base.defaultTrainingConfig.model, ...p.defaultTrainingConfig.model },
          sample: { ...base.defaultTrainingConfig.sample, ...p.defaultTrainingConfig.sample },
          logging: {
            ...base.defaultTrainingConfig.logging,
            ...p.defaultTrainingConfig.logging
          },
          datasets: p.defaultTrainingConfig.datasets ?? base.defaultTrainingConfig.datasets
        })
      : base.defaultTrainingConfig
  }
}

export async function patchSettings(patch: unknown): Promise<AppSettings> {
  const current = await loadSettings()
  const p = SettingsPatchSchema.parse(patch)
  const rootChanging =
    p.libraryRoot !== undefined && p.libraryRoot.trim() !== current.libraryRoot.trim()

  const base = rootChanging ? await switchLibraryRoot(p.libraryRoot!.trim()) : current
  const merged = mergeSettingsPatch(base, p)
  return saveSettings(merged)
}

export function touchRecent(list: string[], id: string, max = 8): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, max)
}
