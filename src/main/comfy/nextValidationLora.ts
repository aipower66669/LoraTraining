import { readdir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { PREVIEW_COMPLETE_MARKER } from '@shared/comfy'
import { compareCheckpointsByStep } from '@shared/checkpoints'
import { isKeepInComfy } from '@shared/checkpoint-prefs'
import { isValidationCompleteForSets } from '@shared/validation-completeness'
import { appError } from '@shared/errors'
import { isPreviewOutputDirName, validationSetLabel } from '@shared/validation-sets'
import { loadCheckpointPrefs } from '../datasets/checkpointPrefs'

const PREVIEW_EXTS = ['.jpg', '.jpeg', '.png', '.webp']

export interface NextValidationLora {
  fileName: string
  relativePath: string
  /** Absolute path to the .safetensors file (staged into Comfy models/loras). */
  fullPath: string
  stem: string
  /**
   * Trigger keyword for the LoRA tag suffix.
   * Prefer dataset.trigger; else parent folder of the snapshot (AutoLoRA-style).
   */
  triggerKeyword: string
}

async function listSafetensors(outputRoot: string): Promise<
  Array<{ fileName: string; relativePath: string; fullPath: string }>
> {
  const { listCheckpointSafetensorsShallow } = await import('../datasets/listCheckpoints')
  const hits = await listCheckpointSafetensorsShallow(outputRoot)
  const out = hits.map((h) => ({
    fileName: h.fileName,
    relativePath: h.relativePath,
    fullPath: h.fullPath
  }))
  out.sort((a, b) =>
    compareCheckpointsByStep(
      { fileName: a.fileName, relativePath: a.relativePath },
      { fileName: b.fileName, relativePath: b.relativePath }
    )
  )
  return out
}

async function hasPreviewImage(previewStemPath: string): Promise<boolean> {
  for (const ext of PREVIEW_EXTS) {
    try {
      const st = await stat(previewStemPath + ext)
      if (st.isFile()) return true
    } catch {
      /* continue */
    }
    try {
      const st = await stat(previewStemPath + ext.toUpperCase())
      if (st.isFile()) return true
    } catch {
      /* continue */
    }
  }
  return false
}

/** Lowercase stems of image files directly under a Set / Stress folder. */
async function listPreviewStemsInDir(setFolder: string): Promise<Set<string>> {
  const stems = new Set<string>()
  let entries: string[]
  try {
    entries = await readdir(setFolder)
  } catch {
    return stems
  }
  for (const name of entries) {
    const ext = extname(name).toLowerCase()
    if (!PREVIEW_EXTS.includes(ext)) continue
    const full = join(setFolder, name)
    try {
      const st = await stat(full)
      if (!st.isFile()) continue
    } catch {
      continue
    }
    stems.add(basename(name, ext).toLowerCase())
  }
  return stems
}

/**
 * True when every validation set has a preview for every keep-in-Comfy
 * checkpoint under `{dataset}/output`. False when there are no included
 * checkpoints (do not treat empty output as Validated).
 */
export async function getValidationSetsStatus(
  datasetFolder: string,
  setCount: number
): Promise<{
  complete: boolean
  safetensorsCount: number
  keepInComfyCount: number
}> {
  if (setCount <= 0) {
    return { complete: false, safetensorsCount: 0, keepInComfyCount: 0 }
  }
  const outputRoot = join(datasetFolder, 'output')
  let list: Awaited<ReturnType<typeof listSafetensors>>
  try {
    list = await listSafetensors(outputRoot)
  } catch {
    return { complete: false, safetensorsCount: 0, keepInComfyCount: 0 }
  }
  const prefs = await loadCheckpointPrefs(datasetFolder)
  const keepInComfyStems = list
    .map((item) => basename(item.fileName, extname(item.fileName)))
    .filter((stem) => isKeepInComfy(prefs, stem))

  const previewStemsBySet = new Map<number, Set<string>>()
  for (let i = 0; i < setCount; i++) {
    previewStemsBySet.set(i, await listPreviewStemsInDir(join(outputRoot, validationSetLabel(i))))
  }
  return {
    complete: isValidationCompleteForSets({ setCount, keepInComfyStems, previewStemsBySet }),
    safetensorsCount: list.length,
    keepInComfyCount: keepInComfyStems.length
  }
}

/**
 * True when every validation set has a preview for every keep-in-Comfy
 * checkpoint under `{dataset}/output`.
 */
export async function areValidationSetsComplete(
  datasetFolder: string,
  setCount: number
): Promise<boolean> {
  const status = await getValidationSetsStatus(datasetFolder, setCount)
  return status.complete
}

/**
 * Next LoRA under `{dataset}/output` that still lacks a preview under
 * `{dataset}/output/Set N/{stem}.jpg` (flat basename — not nested).
 * Throws with PREVIEW_COMPLETE_MARKER when none remain.
 */
export async function resolveNextValidationLora(
  datasetFolder: string,
  setIndex: number,
  datasetTrigger?: string
): Promise<NextValidationLora> {
  const outputRoot = join(datasetFolder, 'output')
  const setFolder = join(outputRoot, validationSetLabel(setIndex))
  let list: Awaited<ReturnType<typeof listSafetensors>>
  try {
    list = await listSafetensors(outputRoot)
  } catch {
    throw appError(
      'validation',
      `Output folder not found or unreadable:\n${outputRoot}`
    )
  }
  if (list.length === 0) {
    throw appError('validation', `No .safetensors snapshots under:\n${outputRoot}`)
  }

  const preferredTrigger = datasetTrigger?.trim() ?? ''
  const prefs = await loadCheckpointPrefs(datasetFolder)

  for (const item of list) {
    const stem = basename(item.fileName, extname(item.fileName))
    if (!isKeepInComfy(prefs, stem)) continue
    const previewStemPath = join(setFolder, stem)
    if (await hasPreviewImage(previewStemPath)) continue
    const parentName = basename(join(item.fullPath, '..')).trim()
    const folderTrigger =
      parentName &&
      parentName.toLowerCase() !== 'output' &&
      !isPreviewOutputDirName(parentName)
        ? parentName
        : ''
    return {
      fileName: item.fileName,
      relativePath: item.relativePath,
      fullPath: item.fullPath,
      stem,
      triggerKeyword: preferredTrigger || folderTrigger || stem
    }
  }

  throw new Error(
    `${PREVIEW_COMPLETE_MARKER}\n\nEvery included snapshot has a matching preview in ${validationSetLabel(setIndex)} (excluded checkpoints are skipped).`
  )
}

/** Poll until a preview for `stem` appears under `output/{setLabel}/`. */
export async function waitForOutputPreview(opts: {
  datasetFolder: string
  setLabel: string
  stem: string
  timeoutMs?: number
}): Promise<boolean> {
  const setFolder = join(opts.datasetFolder, 'output', opts.setLabel)
  const previewStemPath = join(setFolder, opts.stem)
  const deadline = Date.now() + (opts.timeoutMs ?? 15_000)
  while (Date.now() < deadline) {
    if (await hasPreviewImage(previewStemPath)) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return hasPreviewImage(previewStemPath)
}

/** Poll until the set preview for `stem` appears (Comfy may finish before the file is flushed). */
export async function waitForSetPreview(opts: {
  datasetFolder: string
  setIndex: number
  stem: string
  timeoutMs?: number
}): Promise<boolean> {
  return waitForOutputPreview({
    datasetFolder: opts.datasetFolder,
    setLabel: validationSetLabel(opts.setIndex),
    stem: opts.stem,
    timeoutMs: opts.timeoutMs
  })
}

/** Dataset-relative path (`output/{setLabel}/stem.ext`) once the preview file exists. */
export async function resolveOutputPreviewRelativePath(opts: {
  datasetFolder: string
  setLabel: string
  stem: string
}): Promise<string | null> {
  const setFolder = join(opts.datasetFolder, 'output', opts.setLabel)
  for (const ext of PREVIEW_EXTS) {
    for (const e of [ext, ext.toUpperCase()]) {
      try {
        const full = join(setFolder, opts.stem + e)
        const st = await stat(full)
        if (st.isFile()) {
          return `output/${opts.setLabel}/${opts.stem}${ext}`
        }
      } catch {
        /* continue */
      }
    }
  }
  return null
}

/** Dataset-relative path (`output/Set N/stem.ext`) once the preview file exists. */
export async function resolveSetPreviewRelativePath(opts: {
  datasetFolder: string
  setIndex: number
  stem: string
}): Promise<string | null> {
  return resolveOutputPreviewRelativePath({
    datasetFolder: opts.datasetFolder,
    setLabel: validationSetLabel(opts.setIndex),
    stem: opts.stem
  })
}
