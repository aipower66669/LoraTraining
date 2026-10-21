import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { appError } from '@shared/errors'
import {
  defaultValidationSetConfig,
  mergeClonedValidationSets,
  normalizeStyleIndex,
  validationSetFromPrevious,
  validationSetLabel,
  ValidationSetConfigSchema,
  type ValidationSetConfig
} from '@shared/validation-sets'
import { getDatasetRecord } from '../datasets/store'
import { broadcast } from '../events/bus'
import { loadSettings } from '../settings/store'
import { DatasetRecordSchema, type DatasetRecord } from '@shared/schemas/dataset'
import { writeDatasetSidecar } from '../library/datasetSidecar'

/** Set 1 defaults, prefilled from the last validation run prompt when available. */
async function firstValidationSetConfig(): Promise<ValidationSetConfig> {
  const settings = await loadSettings()
  const prompt = settings.lastValidationPrompt.trim()
  return defaultValidationSetConfig(prompt ? { prompt } : {})
}

function outputRoot(folderPath: string): string {
  return join(folderPath.replace(/[/\\]+$/, ''), 'output')
}

function setDir(folderPath: string, index: number): string {
  return join(outputRoot(folderPath), validationSetLabel(index))
}

async function writeRecord(record: DatasetRecord): Promise<DatasetRecord> {
  const next = DatasetRecordSchema.parse({
    ...record,
    updatedAt: new Date().toISOString()
  })
  await writeDatasetSidecar(next.folderPath, next)
  return next
}

async function ensureSetFolders(folderPath: string, count: number): Promise<void> {
  const root = outputRoot(folderPath)
  await mkdir(root, { recursive: true })
  for (let i = 0; i < count; i++) {
    await mkdir(setDir(folderPath, i), { recursive: true })
  }
}

export interface ValidationSetSummary extends ValidationSetConfig {
  index: number
  label: string
}

function toSummaries(sets: ValidationSetConfig[]): ValidationSetSummary[] {
  return sets.map((s, index) => ({
    ...s,
    index,
    label: validationSetLabel(index)
  }))
}

/** List sets; creates Set 1 if the dataset has none yet. */
export async function listValidationSets(datasetId: string): Promise<ValidationSetSummary[]> {
  const r = await getDatasetRecord(datasetId)
  let sets = r.validationSets ?? []
  if (sets.length === 0) {
    sets = [await firstValidationSetConfig()]
    await writeRecord({ ...r, validationSets: sets })
    await ensureSetFolders(r.folderPath, 1)
  } else {
    await ensureSetFolders(r.folderPath, sets.length)
  }
  return toSummaries(sets)
}

export async function addValidationSet(datasetId: string): Promise<ValidationSetSummary[]> {
  const r = await getDatasetRecord(datasetId)
  const sets = [...(r.validationSets ?? [])]
  if (sets.length === 0) {
    sets.push(await firstValidationSetConfig())
  } else {
    sets.push(validationSetFromPrevious(sets[sets.length - 1]!))
  }
  await writeRecord({ ...r, validationSets: sets })
  await ensureSetFolders(r.folderPath, sets.length)
  const { syncDatasetValidatedFlag } = await import('../datasets/store')
  await syncDatasetValidatedFlag(datasetId).catch(() => undefined)
  return toSummaries(sets)
}

export async function updateValidationSet(
  datasetId: string,
  setIndex: number,
  patch: Partial<ValidationSetConfig>
): Promise<ValidationSetSummary[]> {
  const r = await getDatasetRecord(datasetId)
  const sets = [...(r.validationSets ?? [])]
  if (setIndex < 0 || setIndex >= sets.length) {
    throw appError('validation', `Validation set index out of range: ${setIndex}`)
  }
  const current = sets[setIndex]!
  sets[setIndex] = ValidationSetConfigSchema.parse({
    prompt: patch.prompt ?? current.prompt,
    seed: patch.seed ?? current.seed,
    loraWeight: patch.loraWeight ?? current.loraWeight,
    styleIndex: normalizeStyleIndex(patch.styleIndex ?? current.styleIndex),
    validationModel:
      patch.validationModel !== undefined
        ? patch.validationModel.trim() || 'Default'
        : (current.validationModel?.trim() || 'Default'),
    existingCopyPolicy: patch.existingCopyPolicy ?? current.existingCopyPolicy
  })
  await writeRecord({ ...r, validationSets: sets })
  return toSummaries(sets)
}

/**
 * Remove a set, delete its folder, and renumber higher folders (Set 3→Set 2, …).
 */
export async function removeValidationSet(
  datasetId: string,
  setIndex: number
): Promise<ValidationSetSummary[]> {
  const r = await getDatasetRecord(datasetId)
  const sets = [...(r.validationSets ?? [])]
  if (sets.length <= 1) {
    throw appError('validation', 'Set 1 cannot be removed — at least one validation set is required')
  }
  if (setIndex < 0 || setIndex >= sets.length) {
    throw appError('validation', `Validation set index out of range: ${setIndex}`)
  }

  const root = outputRoot(r.folderPath)
  await rm(setDir(r.folderPath, setIndex), { recursive: true, force: true })

  // After deleting Set (setIndex+1), rename Set k → Set k-1 for k = setIndex+2 .. oldCount
  const oldCount = sets.length
  for (let k = setIndex + 2; k <= oldCount; k++) {
    const from = join(root, `Set ${k}`)
    const to = join(root, `Set ${k - 1}`)
    try {
      await stat(from)
      await rename(from, to)
    } catch {
      /* missing folder ok */
    }
  }

  sets.splice(setIndex, 1)
  await writeRecord({ ...r, validationSets: sets })
  await ensureSetFolders(r.folderPath, sets.length)
  const { syncDatasetValidatedFlag } = await import('../datasets/store')
  await syncDatasetValidatedFlag(datasetId).catch(() => undefined)
  broadcast({
    type: 'validation-previews-changed',
    payload: { datasetId, setIndex }
  })
  return listValidationSets(datasetId)
}

/** Delete all preview images in a set folder (keeps the set and its settings). */
export async function clearValidationSetImages(
  datasetId: string,
  setIndex: number
): Promise<{ cleared: true; label: string }> {
  const { cancelValidationIfActiveForDataset } = await import('./validationQueue')
  await cancelValidationIfActiveForDataset(datasetId)
  const r = await getDatasetRecord(datasetId)
  const sets = r.validationSets ?? []
  if (setIndex < 0 || setIndex >= sets.length) {
    throw appError('validation', `Validation set index out of range: ${setIndex}`)
  }
  const dir = setDir(r.folderPath, setIndex)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const label = validationSetLabel(setIndex)
  const { syncDatasetValidatedFlag } = await import('../datasets/store')
  await syncDatasetValidatedFlag(datasetId).catch(() => undefined)
  broadcast({
    type: 'validation-previews-changed',
    payload: { datasetId, setIndex }
  })
  return { cleared: true, label }
}

export function validationSetOutputFolder(datasetFolder: string, setIndex: number): string {
  return setDir(datasetFolder, setIndex)
}

/**
 * Copy validation set configs from another dataset.
 * `overwrite` replaces current sets (and clears their preview folders).
 * `add` appends cloned sets after the existing ones.
 */
export async function cloneValidationSets(input: {
  targetDatasetId: string
  sourceDatasetId: string
  mode: 'overwrite' | 'add'
}): Promise<ValidationSetSummary[]> {
  const { targetDatasetId, sourceDatasetId, mode } = input
  if (targetDatasetId === sourceDatasetId) {
    throw appError('validation', 'Pick a different dataset to clone sets from.')
  }

  const { cancelValidationIfActiveForDataset } = await import('./validationQueue')
  await cancelValidationIfActiveForDataset(targetDatasetId)

  const target = await getDatasetRecord(targetDatasetId)
  const sourceSets = await listValidationSets(sourceDatasetId)
  if (sourceSets.length === 0) {
    throw appError('validation', 'Source dataset has no validation sets to clone.')
  }

  const nextSets = mergeClonedValidationSets(
    target.validationSets ?? [],
    sourceSets,
    mode
  )
  const oldCount = (target.validationSets ?? []).length

  if (mode === 'overwrite') {
    // Drop old set folders so leftover previews don't mismatch new prompts/models.
    const root = outputRoot(target.folderPath)
    await mkdir(root, { recursive: true })
    for (let i = 0; i < Math.max(oldCount, nextSets.length); i++) {
      await rm(setDir(target.folderPath, i), { recursive: true, force: true })
    }
  }

  await writeRecord({ ...target, validationSets: nextSets })
  await ensureSetFolders(target.folderPath, nextSets.length)
  const { syncDatasetValidatedFlag } = await import('../datasets/store')
  await syncDatasetValidatedFlag(targetDatasetId).catch(() => undefined)
  broadcast({
    type: 'validation-previews-changed',
    payload: { datasetId: targetDatasetId, setIndex: 0 }
  })
  return listValidationSets(targetDatasetId)
}
