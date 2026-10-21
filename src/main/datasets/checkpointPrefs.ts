import { access, copyFile, mkdir, readdir, readFile, rename, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, join } from 'node:path'
import {
  CheckpointPrefsFileSchema,
  emptyCheckpointPrefs,
  isKeepInComfy,
  stagedRelativeDir,
  type CheckpointPrefsFile
} from '@shared/checkpoint-prefs'
import {
  relativeDirUnderRoot,
  resolveDatasetComfySubfolder,
  sanitizeComfySubfolder
} from '@shared/comfy-lora-path'
import { isPreviewOutputDirName } from '@shared/validation-sets'
import { appError } from '@shared/errors'
import { atomicWriteJson } from '../security/atomic-write'
import { assertInsideRoot } from '../security/path-guards'
import { loadSettings } from '../settings/store'

const FIND_MAX_DEPTH = 6

function fileNameMatches(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

function prefsPath(datasetFolder: string): string {
  return join(datasetFolder.replace(/[/\\]+$/, ''), 'output', 'checkpoint-prefs.json')
}

/** Serialize read-modify-write of checkpoint-prefs.json per dataset folder. */
const prefsMutateChains = new Map<string, Promise<unknown>>()

/**
 * Load prefs, apply `mutator`, save. Concurrent callers for the same folder
 * queue so keepInComfy toggles are not clobbered by preview-cache writes
 * (e.g. adding a validation set → listOutputs → rewrite validationPreviews).
 */
export async function mutateCheckpointPrefs(
  datasetFolder: string,
  mutator: (prefs: CheckpointPrefsFile) => void | Promise<void>
): Promise<CheckpointPrefsFile> {
  const key = prefsPath(datasetFolder).toLowerCase()
  const prev = prefsMutateChains.get(key) ?? Promise.resolve()
  const next = prev.then(async () => {
    const prefs = await loadCheckpointPrefs(datasetFolder)
    await mutator(prefs)
    await saveCheckpointPrefs(datasetFolder, prefs)
    return prefs
  })
  prefsMutateChains.set(
    key,
    next.then(
      () => undefined,
      () => undefined
    )
  )
  return next
}

export async function loadCheckpointPrefs(datasetFolder: string): Promise<CheckpointPrefsFile> {
  const path = prefsPath(datasetFolder)
  try {
    const raw = await readFile(path, 'utf8')
    return CheckpointPrefsFileSchema.parse(JSON.parse(raw))
  } catch {
    return emptyCheckpointPrefs()
  }
}

async function saveCheckpointPrefs(
  datasetFolder: string,
  file: CheckpointPrefsFile
): Promise<void> {
  await atomicWriteJson(
    prefsPath(datasetFolder),
    CheckpointPrefsFileSchema.parse({ ...file, version: 2 })
  )
}

export async function requireLorasFolder(): Promise<string> {
  const settings = await loadSettings()
  const root = settings.comfy.lorasFolder?.trim()
  if (!root) {
    throw appError('tool-not-configured', 'ComfyUI LoRA folder is not set in Settings', {
      remediation:
        'Set Settings → ComfyUI → LoRA folder to your models/loras path so the app can delete and move staged files.'
    })
  }
  return root
}

export function resolveDefaultComfySubfolder(opts: {
  datasetSubfolder?: string | null
  globalSubfolder?: string | null
}): string {
  return resolveDatasetComfySubfolder(opts)
}

function absoluteUnderLoras(root: string, relativeDir: string, fileName: string): string {
  const sub = sanitizeComfySubfolder(relativeDir) || '!Testing'
  const base = basename(fileName)
  if (!base || base.includes('..') || base.includes('/') || base.includes('\\')) {
    throw appError('validation', 'Invalid LoRA file name')
  }
  return assertInsideRoot(root, join(root, ...sub.split('/'), base))
}

export async function stagedPathCandidates(opts: {
  datasetFolder: string
  fileName: string
  datasetSubfolder?: string | null
}): Promise<string[]> {
  const settings = await loadSettings()
  const root = settings.comfy.lorasFolder?.trim()
  if (!root) return []

  const stem = basename(opts.fileName).replace(/\.safetensors$/i, '')
  const prefs = await loadCheckpointPrefs(opts.datasetFolder)
  const tracked = stagedRelativeDir(prefs, stem)
  const datasetDefault = resolveDefaultComfySubfolder({
    datasetSubfolder: opts.datasetSubfolder,
    globalSubfolder: settings.comfy.validationLoraSubfolder
  })
  const globalDefault = sanitizeComfySubfolder(settings.comfy.validationLoraSubfolder) || '!Testing'

  const dirs = [tracked, datasetDefault, globalDefault, '!Testing'].filter(
    (d, i, arr): d is string => Boolean(d) && arr.indexOf(d) === i
  )
  return dirs.map((d) => absoluteUnderLoras(root, d, opts.fileName))
}

/** Recursive find of a LoRA basename under models/loras (on demand only). */
export async function findComfyLoraByFileName(
  fileName: string,
  root?: string
): Promise<{ relativeDir: string; fullPath: string } | null> {
  let lorasRoot = root?.trim() ?? ''
  if (!lorasRoot) {
    try {
      lorasRoot = await requireLorasFolder()
    } catch {
      return null
    }
  }
  const base = basename(fileName)
  if (!base || base.includes('..') || base.includes('/') || base.includes('\\')) {
    return null
  }

  async function walk(
    rel: string,
    depth: number
  ): Promise<{ relativeDir: string; fullPath: string } | null> {
    if (depth > FIND_MAX_DEPTH) return null
    const abs = rel ? join(lorasRoot, ...rel.split('/')) : lorasRoot
    let entries
    try {
      entries = await readdir(abs, { withFileTypes: true })
    } catch {
      return null
    }
    for (const e of entries) {
      if (!e.isFile() || !fileNameMatches(e.name, base)) continue
      const fullPath = assertInsideRoot(lorasRoot, join(abs, e.name))
      return {
        relativeDir: sanitizeComfySubfolder(rel),
        fullPath
      }
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      const next = rel ? `${rel}/${e.name}` : e.name
      const hit = await walk(next, depth + 1)
      if (hit) return hit
    }
    return null
  }

  return walk('', 0)
}

export type LocatedComfyLora = {
  fullPath: string
  relativeDir: string
  /** True when found by tree scan after known candidate paths missed. */
  viaScan: boolean
}

/**
 * Resolve a staged LoRA: known candidate dirs first, then a one-shot tree scan.
 */
export async function locateComfyLora(opts: {
  datasetFolder: string
  fileName: string
  datasetSubfolder?: string | null
}): Promise<LocatedComfyLora | null> {
  const settings = await loadSettings()
  const root = settings.comfy.lorasFolder?.trim()
  if (!root) return null

  const candidates = await stagedPathCandidates(opts)
  for (const full of candidates) {
    try {
      await access(full, constants.F_OK)
      const relativeDir = relativeDirUnderRoot(root, full)
      return {
        fullPath: full,
        relativeDir: relativeDir || sanitizeComfySubfolder(opts.datasetSubfolder) || '!Testing',
        viaScan: false
      }
    } catch {
      /* try next / scan */
    }
  }

  const found = await findComfyLoraByFileName(opts.fileName, root)
  if (!found) return null
  return {
    fullPath: found.fullPath,
    relativeDir: found.relativeDir || '!Testing',
    viaScan: true
  }
}

/**
 * One walk of models/loras → basename (lowercase) → relative dir.
 * Used to heal stale checkpoint-prefs paths without N full scans.
 */
export async function indexComfyLoraBasenames(
  root?: string
): Promise<Map<string, { relativeDir: string; fullPath: string }>> {
  let lorasRoot = root?.trim() ?? ''
  if (!lorasRoot) {
    try {
      lorasRoot = await requireLorasFolder()
    } catch {
      return new Map()
    }
  }

  const out = new Map<string, { relativeDir: string; fullPath: string }>()

  async function walk(rel: string, depth: number): Promise<void> {
    if (depth > FIND_MAX_DEPTH) return
    const abs = rel ? join(lorasRoot, ...rel.split('/')) : lorasRoot
    let entries
    try {
      entries = await readdir(abs, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isFile() && e.name.toLowerCase().endsWith('.safetensors')) {
        const key = e.name.toLowerCase()
        if (!out.has(key)) {
          const fullPath = assertInsideRoot(lorasRoot, join(abs, e.name))
          out.set(key, {
            relativeDir: sanitizeComfySubfolder(rel),
            fullPath
          })
        }
        continue
      }
      if (e.isDirectory() && !e.name.startsWith('.')) {
        const next = rel ? `${rel}/${e.name}` : e.name
        await walk(next, depth + 1)
      }
    }
  }

  await walk('', 0)
  return out
}

/**
 * Heal prefs when recorded `comfyRelativeDir` no longer matches disk
 * (file moved/deleted outside the app). Updates prefs in place; returns
 * stem → current relative dir (or null if absent).
 *
 * Rematch is one pass: if the recorded path is gone, look up the same basename
 * under models/loras and rewrite the folder — do not clear first and wait for a
 * later "re-hash". Also rediscovers keep-in-Comfy stems that lost their path.
 */
export async function reconcileStagedComfyDirs(opts: {
  datasetFolder: string
  fileNames: readonly string[]
}): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>()
  const settings = await loadSettings()
  const root = settings.comfy.lorasFolder?.trim()
  const prefs = await loadCheckpointPrefs(opts.datasetFolder)

  if (!root) {
    for (const fileName of opts.fileNames) {
      const stem = basename(fileName).replace(/\.safetensors$/i, '')
      if (!stem) continue
      result.set(stem, stagedRelativeDir(prefs, stem) ?? null)
    }
    return result
  }

  type Row = { fileName: string; stem: string; keep: boolean; tracked: string | undefined }
  const rows: Row[] = []
  for (const fileName of opts.fileNames) {
    const stem = basename(fileName).replace(/\.safetensors$/i, '')
    if (!stem) continue
    rows.push({
      fileName,
      stem,
      keep: isKeepInComfy(prefs, stem),
      tracked: stagedRelativeDir(prefs, stem)
    })
  }

  // Need a tree walk when any kept/tracked file is missing (or keep with no path yet).
  let needsIndex = false
  for (const row of rows) {
    if (!row.keep && !row.tracked) {
      result.set(row.stem, null)
      continue
    }
    if (!row.tracked) {
      needsIndex = true
      continue
    }
    const trackedPath = absoluteUnderLoras(root, row.tracked, row.fileName)
    try {
      await access(trackedPath, constants.F_OK)
      result.set(row.stem, row.tracked)
    } catch {
      needsIndex = true
    }
  }

  if (!needsIndex) return result

  const index = await indexComfyLoraBasenames(root)
  let dirty = false

  for (const row of rows) {
    if (result.has(row.stem)) continue
    if (!row.keep && !row.tracked) {
      result.set(row.stem, null)
      continue
    }

    const hit = index.get(basename(row.fileName).toLowerCase())
    if (hit) {
      const dir = hit.relativeDir || '!Testing'
      if (dir !== row.tracked) {
        prefs.comfyRelativeDir[row.stem] = dir
        dirty = true
      }
      result.set(row.stem, dir)
      continue
    }

    // Truly gone from models/loras — drop path only; keepInComfy stays as-is.
    if (row.tracked) {
      delete prefs.comfyRelativeDir[row.stem]
      dirty = true
    }
    result.set(row.stem, null)
  }

  if (dirty) {
    // Replace path map only — keepInComfy / validationPreviews come from a fresh load.
    const healedDirs = { ...prefs.comfyRelativeDir }
    await mutateCheckpointPrefs(opts.datasetFolder, (latest) => {
      latest.comfyRelativeDir = healedDirs
    })
  }
  return result
}

async function applyLocatedComfyLora(opts: {
  datasetId?: string
  datasetFolder: string
  fileName: string
  located: LocatedComfyLora
}): Promise<{ comfyRelativeDir: string; datasetComfyLoraSubfolder: string | null }> {
  const dir = sanitizeComfySubfolder(opts.located.relativeDir)
  if (dir) {
    await recordStagedComfyLocation({
      datasetFolder: opts.datasetFolder,
      fileName: opts.fileName,
      relativeDir: dir
    })
  }
  const datasetComfyLoraSubfolder: string | null = null
  // Per-dataset LoRA folder overrides were removed — never write back to dataset.json.
  return { comfyRelativeDir: dir, datasetComfyLoraSubfolder }
}

export async function deleteStagedValidationLora(opts: {
  datasetFolder: string
  fileName: string
  datasetSubfolder?: string | null
}): Promise<{ deleted: boolean; path: string | null }> {
  const settings = await loadSettings()
  if (!settings.comfy.lorasFolder?.trim()) {
    throw appError('tool-not-configured', 'ComfyUI LoRA folder is not set in Settings', {
      remediation:
        'Set Settings → ComfyUI → LoRA folder so the app can remove staged LoRAs when you untick Keep in Comfy.'
    })
  }

  const located = await locateComfyLora(opts)
  if (!located) {
    return { deleted: false, path: null }
  }
  try {
    await unlink(located.fullPath)
    return { deleted: true, path: located.fullPath }
  } catch {
    return { deleted: false, path: null }
  }
}

/** Find `{fileName}` under the dataset `output/` tree (training checkpoints). */
async function findDatasetCheckpointPath(
  datasetFolder: string,
  fileName: string,
  relativePath?: string | null
): Promise<string> {
  const base = basename(fileName)
  if (!base || base.includes('..') || base.includes('/') || base.includes('\\')) {
    throw appError('validation', 'Invalid checkpoint file name')
  }
  const outputRoot = join(datasetFolder.replace(/[/\\]+$/, ''), 'output')

  if (relativePath?.trim()) {
    const norm = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
    if (norm && !norm.includes('..')) {
      const candidate = assertInsideRoot(datasetFolder, join(outputRoot, ...norm.split('/')))
      try {
        await access(candidate, constants.F_OK)
        return candidate
      } catch {
        /* fall through to walk */
      }
    }
  }

  async function walk(dir: string, depth: number): Promise<string | null> {
    if (depth > 8) return null
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return null
    }
    for (const e of entries) {
      if (e.isFile() && fileNameMatches(e.name, base)) {
        return assertInsideRoot(datasetFolder, join(dir, e.name))
      }
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || isPreviewOutputDirName(e.name)) continue
      const hit = await walk(join(dir, e.name), depth + 1)
      if (hit) return hit
    }
    return null
  }

  const found = await walk(outputRoot, 0)
  if (!found) {
    throw appError('not-found', `Checkpoint not found under dataset output: ${base}`, {
      remediation: 'Rescan the Output tab or check that the .safetensors file still exists.'
    })
  }
  return found
}

/**
 * Shared Comfy LoRA subfolder for this dataset’s checkpoints.
 * Prefers where siblings already live (prefs + disk under models/loras);
 * falls back to Settings → Val. LoRA (`!Testing`).
 */
export async function resolveDatasetStagingRelativeDir(opts: {
  datasetFolder: string
  /** Stem being staged now — ignored when counting siblings. */
  excludeStem?: string
  datasetSubfolder?: string | null
}): Promise<string> {
  const settings = await loadSettings()
  const fallback = resolveDefaultComfySubfolder({
    datasetSubfolder: opts.datasetSubfolder,
    globalSubfolder: settings.comfy.validationLoraSubfolder
  })
  const prefs = await loadCheckpointPrefs(opts.datasetFolder)
  const byStem = new Map<string, string>()

  for (const [stem, raw] of Object.entries(prefs.comfyRelativeDir)) {
    if (opts.excludeStem && stem === opts.excludeStem) continue
    const dir = sanitizeComfySubfolder(raw)
    if (!dir) continue
    byStem.set(stem, dir)
  }

  const root = settings.comfy.lorasFolder?.trim()
  if (root) {
    const index = await indexComfyLoraBasenames(root)
    const names = await listDatasetCheckpointFileNames(opts.datasetFolder)
    for (const name of names) {
      const stem = basename(name).replace(/\.safetensors$/i, '')
      if (!stem) continue
      if (opts.excludeStem && stem === opts.excludeStem) continue
      const hit = index.get(name.toLowerCase())
      if (!hit) continue
      const dir = sanitizeComfySubfolder(hit.relativeDir) || fallback
      byStem.set(stem, dir)
    }
  }

  if (byStem.size === 0) return fallback

  const counts = new Map<string, number>()
  for (const dir of byStem.values()) {
    counts.set(dir, (counts.get(dir) ?? 0) + 1)
  }
  let best = fallback
  let bestN = -1
  for (const [dir, n] of counts) {
    if (n > bestN || (n === bestN && dir.localeCompare(best) < 0)) {
      best = dir
      bestN = n
    }
  }
  return bestN > 0 ? best : fallback
}

/** Basenames of `.safetensors` under dataset `output/` (skips Set/Stress preview dirs). */
async function listDatasetCheckpointFileNames(datasetFolder: string): Promise<string[]> {
  const outputRoot = join(datasetFolder.replace(/[/\\]+$/, ''), 'output')
  const out: string[] = []

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 8) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isFile() && e.name.toLowerCase().endsWith('.safetensors')) {
        out.push(e.name)
        continue
      }
      if (e.isDirectory() && !e.name.startsWith('.') && !isPreviewOutputDirName(e.name)) {
        await walk(join(dir, e.name), depth + 1)
      }
    }
  }

  await walk(outputRoot, 0)
  return out
}

/**
 * Copy a dataset checkpoint into the dataset’s shared LoRA subfolder
 * (sibling location if any, else Settings → Val. LoRA) when it is not
 * already present anywhere under models/loras.
 */
export async function copyCheckpointIntoComfy(opts: {
  datasetFolder: string
  fileName: string
  relativePath?: string | null
  datasetSubfolder?: string | null
}): Promise<{ relativeDir: string; fullPath: string; copied: boolean }> {
  const root = await requireLorasFolder()
  const stem = basename(opts.fileName).replace(/\.safetensors$/i, '')
  const targetDir = await resolveDatasetStagingRelativeDir({
    datasetFolder: opts.datasetFolder,
    excludeStem: stem || undefined,
    datasetSubfolder: opts.datasetSubfolder
  })
  const destPath = absoluteUnderLoras(root, targetDir, opts.fileName)
  await mkdir(join(root, ...targetDir.split('/')), { recursive: true })

  try {
    await access(destPath, constants.F_OK)
    await recordStagedComfyLocation({
      datasetFolder: opts.datasetFolder,
      fileName: opts.fileName,
      relativeDir: targetDir
    })
    return { relativeDir: targetDir, fullPath: destPath, copied: false }
  } catch {
    /* need copy */
  }

  const source = await findDatasetCheckpointPath(
    opts.datasetFolder,
    opts.fileName,
    opts.relativePath
  )
  await copyFile(source, destPath)
  await recordStagedComfyLocation({
    datasetFolder: opts.datasetFolder,
    fileName: opts.fileName,
    relativeDir: targetDir
  })
  return { relativeDir: targetDir, fullPath: destPath, copied: true }
}

export async function setCheckpointKeepInComfy(opts: {
  datasetId?: string
  datasetFolder: string
  fileName: string
  keepInComfy: boolean
  /** Output-relative path of the checkpoint (preferred source for copy). */
  relativePath?: string | null
  datasetSubfolder?: string | null
}): Promise<{
  keepInComfy: boolean
  deletedFromComfy: boolean
  copiedToComfy: boolean
  comfyRelativeDir: string | null
  datasetComfyLoraSubfolder: string | null
  rediscovered: boolean
}> {
  const stem = basename(opts.fileName).replace(/\.safetensors$/i, '')
  if (!stem) throw appError('validation', 'Invalid checkpoint file name')

  await mutateCheckpointPrefs(opts.datasetFolder, (prefs) => {
    if (opts.keepInComfy) {
      delete prefs.keepInComfy[stem]
    } else {
      prefs.keepInComfy[stem] = false
    }
  })

  let deletedFromComfy = false
  let copiedToComfy = false
  let comfyRelativeDir: string | null = null
  let datasetComfyLoraSubfolder: string | null = null
  let rediscovered = false

  const prefsAfterKeep = await loadCheckpointPrefs(opts.datasetFolder)
  comfyRelativeDir = stagedRelativeDir(prefsAfterKeep, stem) ?? null

  if (!opts.keepInComfy) {
    const result = await deleteStagedValidationLora({
      datasetFolder: opts.datasetFolder,
      fileName: opts.fileName,
      datasetSubfolder: opts.datasetSubfolder
    })
    deletedFromComfy = result.deleted
    if (deletedFromComfy || comfyRelativeDir) {
      await mutateCheckpointPrefs(opts.datasetFolder, (next) => {
        delete next.comfyRelativeDir[stem]
      })
      comfyRelativeDir = null
    }
  } else {
    // Anywhere under models/loras (not just !Testing).
    const located = await locateComfyLora({
      datasetFolder: opts.datasetFolder,
      fileName: opts.fileName,
      datasetSubfolder: opts.datasetSubfolder
    })
    if (located) {
      rediscovered = located.viaScan
      const applied = await applyLocatedComfyLora({
        datasetId: opts.datasetId,
        datasetFolder: opts.datasetFolder,
        fileName: opts.fileName,
        located
      })
      comfyRelativeDir = applied.comfyRelativeDir || null
      datasetComfyLoraSubfolder = applied.datasetComfyLoraSubfolder
    } else {
      const staged = await copyCheckpointIntoComfy({
        datasetFolder: opts.datasetFolder,
        fileName: opts.fileName,
        relativePath: opts.relativePath,
        datasetSubfolder: opts.datasetSubfolder
      })
      copiedToComfy = staged.copied
      comfyRelativeDir = staged.relativeDir
    }
  }

  return {
    keepInComfy: opts.keepInComfy,
    deletedFromComfy,
    copiedToComfy,
    comfyRelativeDir,
    datasetComfyLoraSubfolder,
    rediscovered
  }
}

export async function recordStagedComfyLocation(opts: {
  datasetFolder: string
  fileName: string
  relativeDir: string
}): Promise<void> {
  const stem = basename(opts.fileName).replace(/\.safetensors$/i, '')
  if (!stem) return
  const dir = sanitizeComfySubfolder(opts.relativeDir)
  if (!dir) return
  await mutateCheckpointPrefs(opts.datasetFolder, (prefs) => {
    prefs.comfyRelativeDir[stem] = dir
  })
}

export async function moveCheckpointInComfy(opts: {
  datasetFolder: string
  fileName: string
  targetRelativeDir: string
  datasetSubfolder?: string | null
}): Promise<{ relativeDir: string; fullPath: string; movedFile: boolean }> {
  const root = await requireLorasFolder()
  const targetDir = sanitizeComfySubfolder(opts.targetRelativeDir)
  if (!targetDir) {
    throw appError('validation', 'Enter a folder path under the ComfyUI LoRA root', {
      remediation: 'Example: !Testing or Characters/MyLora'
    })
  }

  const stem = basename(opts.fileName).replace(/\.safetensors$/i, '')
  const located = await locateComfyLora({
    datasetFolder: opts.datasetFolder,
    fileName: opts.fileName,
    datasetSubfolder: opts.datasetSubfolder
  })
  const sourcePath = located?.fullPath ?? null

  const destPath = absoluteUnderLoras(root, targetDir, opts.fileName)
  await mkdir(join(root, ...targetDir.split('/')), { recursive: true })

  let movedFile = false
  if (sourcePath) {
    const same =
      process.platform === 'win32'
        ? sourcePath.toLowerCase() === destPath.toLowerCase()
        : sourcePath === destPath
    if (!same) {
      try {
        await access(destPath, constants.F_OK)
        throw appError('validation', `A file already exists at the destination:\n${destPath}`, {
          remediation: 'Remove or rename the existing file first.'
        })
      } catch (err) {
        if (
          err &&
          typeof err === 'object' &&
          'code' in err &&
          (err as { code: string }).code === 'validation'
        ) {
          throw err
        }
      }
      await rename(sourcePath, destPath)
      movedFile = true
    }
  }

  await mutateCheckpointPrefs(opts.datasetFolder, (latest) => {
    latest.comfyRelativeDir[stem] = targetDir
    delete latest.keepInComfy[stem]
  })

  return { relativeDir: targetDir, fullPath: destPath, movedFile }
}

export async function listComfyLoraSubfolders(): Promise<string[]> {
  const root = await requireLorasFolder()
  const out = new Set<string>()

  async function walk(rel: string, depth: number): Promise<void> {
    if (depth > 4) return
    const abs = rel ? join(root, ...rel.split('/')) : root
    let entries
    try {
      entries = await readdir(abs, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (e.name.startsWith('.')) continue
      const next = rel ? `${rel}/${e.name}` : e.name
      out.add(next.replace(/\\/g, '/'))
      await walk(next, depth + 1)
    }
  }

  await walk('', 0)
  return [...out].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

export { isKeepInComfy, stagedRelativeDir }
