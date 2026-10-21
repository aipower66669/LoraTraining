import { basename, join, relative, resolve, sep } from 'node:path'
import { sanitizeDatasetFolderName } from './schemas/dataset'

/** Sidecar filenames / dirs inside the library tree. */
export const LIBRARY_CATEGORIES_FILE = 'categories.json'
export const CATEGORY_SIDECAR = 'category.json'
export const DATASET_SIDECAR = 'dataset.json'
/**
 * Sibling of dataset.json — female given names currently assigned as identity
 * tags in this dataset’s captions (one name per line).
 */
export const IDENTITY_NAMES_USED_FILE = 'identity-names-used.txt'
/** Hidden (Windows) thumb cache; `!` prefix is skipped by dataset discovery. */
export const THUMBNAILS_DIR = '!Thumbnails'
/**
 * Shared library scratch root for ComfyUI tool runs (`!Temp/upscale`, `!Temp/diversify`).
 * One place at library root — not per-dataset. `!` skipped by discovery.
 */
export const TEMP_DIR = '!Temp'
/** @deprecated Former per-dataset scratch name (`!UpscaleTmp`). New runs use `{libraryRoot}/!Temp/upscale`. */
export const LEGACY_UPSCALE_TMP_DIR = '!UpscaleTmp'
/** @deprecated Former per-dataset scratch name (`!DiversifyTmp`). New runs use `{libraryRoot}/!Temp/diversify`. */
export const LEGACY_DIVERSIFY_TMP_DIR = '!DiversifyTmp'
/** Hidden (Windows) training jobs store at library root; `!` skipped by discovery. */
export const JOBS_DIR = '!Jobs'
/** Comfy workflow safety backups (`last.bak`, history); `!` skipped by discovery. */
export const WORKFLOW_BACKUPS_DIR = '!WorkflowBackups'
/** Library-level settings (tools, Comfy, queue prefs, training defaults, recents, prompts). */
export const LIBRARY_SETTINGS_FILE = 'settings.json'
/** Library-level captured ComfyUI validation workflow profile. */
export const LIBRARY_VALIDATION_WORKFLOW_FILE = 'comfy-workflow-validation.json'
/** Legacy filename (one rename ago) — read as a fallback if the current one isn't there yet. */
export const LEGACY_LIBRARY_VALIDATION_WORKFLOW_FILE = 'validation-comfy-workflow.json'
/** Legacy filename (pre-rename, two renames ago) — read as a fallback if neither newer one is there yet. */
export const LEGACY_LIBRARY_WORKFLOW_FILE = 'comfy-workflow.json'
/** Library-level captured ComfyUI upscale/detail workflow profile. */
export const LIBRARY_UPSCALE_WORKFLOW_FILE = 'comfy-workflow-upscale.json'
/** Legacy filename (pre-rename) — read as a fallback if the current one isn't there yet. */
export const LEGACY_LIBRARY_UPSCALE_WORKFLOW_FILE = 'upscale-comfy-workflow.json'
/** Library-level Diversify · Context workflow. */
export const LIBRARY_CONTEXT_WORKFLOW_FILE = 'comfy-workflow-context.json'
/** Library-level Diversify · Expression workflow. */
export const LIBRARY_EXPRESSION_WORKFLOW_FILE = 'comfy-workflow-expression.json'

export function sanitizeCategoryFolderName(name: string): string {
  return sanitizeDatasetFolderName(name) || 'category'
}

/**
 * Normalize a category `folder` value from categories.json.
 * Accepts nested relative paths under libraryRoot, e.g. `Group/Sub/Category`.
 * Uses `/` separators in the returned string; rejects `.` / `..` / absolute paths.
 */
export function normalizeCategoryRelativeFolder(relativeFolder: string): string {
  const trimmed = relativeFolder.trim().replace(/\\/g, '/')
  if (!trimmed) return 'category'
  if (/^[a-zA-Z]:/.test(trimmed) || trimmed.startsWith('/')) {
    throw new Error(`Category folder must be relative to libraryRoot, got: ${relativeFolder}`)
  }
  const parts = trimmed
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return 'category'
  for (const part of parts) {
    if (part === '.' || part === '..') {
      throw new Error(`Category folder must not contain '.' or '..': ${relativeFolder}`)
    }
  }
  return parts.join('/')
}

/**
 * Convert an absolute path under `libraryRoot` into a normalized relative folder.
 * Throws if the path is outside the library (or is the library root itself).
 */
export function relativeFolderUnderLibraryRoot(libraryRoot: string, absolutePath: string): string {
  const rootResolved = resolve(libraryRoot)
  const absResolved = resolve(absolutePath)
  if (absResolved === rootResolved) {
    throw new Error('Category folder cannot be the library root itself')
  }
  const rel = relative(rootResolved, absResolved)
  if (!rel || rel.startsWith('..') || resolve(rootResolved, rel) !== absResolved) {
    throw new Error(`Category folder must be inside the library root (${libraryRoot})`)
  }
  return normalizeCategoryRelativeFolder(rel)
}

/**
 * Accept either a relative folder (`Group/Cat`) or an absolute path under the library.
 * Empty input falls back to a sanitized name.
 */
export function resolveCategoryFolderInput(
  libraryRoot: string,
  input: string | undefined | null,
  fallbackName: string
): string {
  const trimmed = (input ?? '').trim()
  if (!trimmed) return sanitizeCategoryFolderName(fallbackName)
  const looksAbsolute =
    /^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('\\\\')
  if (looksAbsolute) {
    return relativeFolderUnderLibraryRoot(libraryRoot, trimmed)
  }
  return normalizeCategoryRelativeFolder(trimmed)
}

/** Unique folder name under a parent; appends (2), (3), … if needed. */
export function uniqueChildName(desired: string, taken: Set<string>): string {
  const base = desired || 'item'
  if (!taken.has(base.toLowerCase())) {
    taken.add(base.toLowerCase())
    return base
  }
  let n = 2
  while (taken.has(`${base} (${n})`.toLowerCase())) n++
  const next = `${base} (${n})`
  taken.add(next.toLowerCase())
  return next
}

/** Absolute category directory: libraryRoot + relative folder (may be nested). */
export function categoryDir(libraryRoot: string, relativeFolder: string): string {
  const rel = normalizeCategoryRelativeFolder(relativeFolder)
  const rootResolved = resolve(libraryRoot)
  const abs = join(rootResolved, ...rel.split('/'))
  const prefix = rootResolved.endsWith(sep) ? rootResolved : rootResolved + sep
  if (abs !== rootResolved && !abs.startsWith(prefix)) {
    throw new Error(`Category folder escapes libraryRoot: ${relativeFolder}`)
  }
  return abs
}

export function categorySidecarPath(libraryRoot: string, relativeFolder: string): string {
  return join(categoryDir(libraryRoot, relativeFolder), CATEGORY_SIDECAR)
}

export function datasetSidecarPath(datasetFolder: string): string {
  return join(datasetFolder, DATASET_SIDECAR)
}

/** `{datasetFolder}/identity-names-used.txt` — names assigned as identity tags. */
export function identityNamesUsedPath(datasetFolder: string): string {
  return join(datasetFolder, IDENTITY_NAMES_USED_FILE)
}

export function thumbnailsDir(datasetFolder: string): string {
  return join(datasetFolder, THUMBNAILS_DIR)
}

/** `{libraryRoot}/!Temp` — shared scratch for Comfy tool runs. */
export function libraryTempDir(libraryRoot: string): string {
  return join(resolve(libraryRoot), TEMP_DIR)
}

/** `{libraryRoot}/!Temp/upscale` — in-flight upscale/detail Comfy output. */
export function libraryUpscaleTmpDir(libraryRoot: string): string {
  return join(libraryTempDir(libraryRoot), 'upscale')
}

/** `{libraryRoot}/!Temp/diversify` — in-flight Diversify Comfy output. */
export function libraryDiversifyTmpDir(libraryRoot: string): string {
  return join(libraryTempDir(libraryRoot), 'diversify')
}

/** Absolute jobs directory under library root (`!Jobs`). */
export function libraryJobsDir(libraryRoot: string): string {
  return join(libraryRoot, JOBS_DIR)
}

/** Absolute path to `{libraryRoot}/settings.json`. */
export function librarySettingsPath(libraryRoot: string): string {
  return join(resolve(libraryRoot), LIBRARY_SETTINGS_FILE)
}

/** Absolute path to `{libraryRoot}/comfy-workflow-validation.json`. */
export function libraryValidationWorkflowPath(libraryRoot: string): string {
  return join(resolve(libraryRoot), LIBRARY_VALIDATION_WORKFLOW_FILE)
}

/** Absolute path to the legacy `{libraryRoot}/validation-comfy-workflow.json` (one rename ago). */
export function legacyLibraryValidationWorkflowPath(libraryRoot: string): string {
  return join(resolve(libraryRoot), LEGACY_LIBRARY_VALIDATION_WORKFLOW_FILE)
}

/** Absolute path to the legacy `{libraryRoot}/comfy-workflow.json` (pre-rename, two renames ago). */
export function legacyLibraryWorkflowPath(libraryRoot: string): string {
  return join(resolve(libraryRoot), LEGACY_LIBRARY_WORKFLOW_FILE)
}

/** Absolute path to `{libraryRoot}/comfy-workflow-upscale.json`. */
export function libraryUpscaleWorkflowPath(libraryRoot: string): string {
  return join(resolve(libraryRoot), LIBRARY_UPSCALE_WORKFLOW_FILE)
}

/** Absolute path to the legacy `{libraryRoot}/upscale-comfy-workflow.json` (pre-rename). */
export function legacyLibraryUpscaleWorkflowPath(libraryRoot: string): string {
  return join(resolve(libraryRoot), LEGACY_LIBRARY_UPSCALE_WORKFLOW_FILE)
}

/** Absolute path to `{libraryRoot}/comfy-workflow-context.json`. */
export function libraryContextWorkflowPath(libraryRoot: string): string {
  return join(resolve(libraryRoot), LIBRARY_CONTEXT_WORKFLOW_FILE)
}

/** Absolute path to `{libraryRoot}/comfy-workflow-expression.json`. */
export function libraryExpressionWorkflowPath(libraryRoot: string): string {
  return join(resolve(libraryRoot), LIBRARY_EXPRESSION_WORKFLOW_FILE)
}

/** Prefer basename of an absolute folderPath for migration naming. */
export function folderBaseName(folderPath: string): string {
  return basename(folderPath.replace(/[/\\]+$/, '')) || 'dataset'
}

/** Skip hidden dirs and `!…` folders (reserved for thumbs / external use). */
export function isDiscoverableDatasetDirName(name: string): boolean {
  return Boolean(name) && !name.startsWith('.') && !name.startsWith('!')
}
