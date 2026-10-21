import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { appError } from '@shared/errors'
import {
  defaultWeightSetConfig,
  weightSetFromPrevious,
  weightSetLabel,
  WeightSetConfigSchema,
  type WeightSetConfig
} from '@shared/weight-sets'
import { normalizeStyleIndex } from '@shared/validation-sets'
import { getDatasetRecord } from '../datasets/store'
import { broadcast } from '../events/bus'
import { loadSettings, patchSettings } from '../settings/store'
import { DatasetRecordSchema, type DatasetRecord } from '@shared/schemas/dataset'
import { writeDatasetSidecar } from '../library/datasetSidecar'

async function firstWeightSetConfig(): Promise<WeightSetConfig> {
  const settings = await loadSettings()
  const prompt = settings.lastValidationPrompt.trim()
  const range = settings.lastWeightRange
  return defaultWeightSetConfig({
    ...(prompt ? { prompt } : {}),
    weightMin: range.weightMin,
    weightMax: range.weightMax,
    weightStep: range.weightStep
  })
}

function outputRoot(folderPath: string): string {
  return join(folderPath.replace(/[/\\]+$/, ''), 'output')
}

function setDir(folderPath: string, index: number): string {
  return join(outputRoot(folderPath), weightSetLabel(index))
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

export interface WeightSetSummary extends WeightSetConfig {
  index: number
  label: string
}

function toSummaries(sets: WeightSetConfig[]): WeightSetSummary[] {
  return sets.map((s, index) => ({
    ...s,
    index,
    label: weightSetLabel(index)
  }))
}

/** List sets; creates Weight 1 if the dataset has none yet. */
export async function listWeightSets(datasetId: string): Promise<WeightSetSummary[]> {
  const r = await getDatasetRecord(datasetId)
  let sets = r.weightSets ?? []
  if (sets.length === 0) {
    sets = [await firstWeightSetConfig()]
    await writeRecord({ ...r, weightSets: sets })
    await ensureSetFolders(r.folderPath, 1)
  } else {
    await ensureSetFolders(r.folderPath, sets.length)
  }
  return toSummaries(sets)
}

export async function addWeightSet(datasetId: string): Promise<WeightSetSummary[]> {
  const r = await getDatasetRecord(datasetId)
  const sets = [...(r.weightSets ?? [])]
  if (sets.length === 0) {
    sets.push(await firstWeightSetConfig())
  } else {
    sets.push(weightSetFromPrevious(sets[sets.length - 1]!))
  }
  await writeRecord({ ...r, weightSets: sets })
  await ensureSetFolders(r.folderPath, sets.length)
  return toSummaries(sets)
}

export async function updateWeightSet(
  datasetId: string,
  setIndex: number,
  patch: Partial<WeightSetConfig>
): Promise<WeightSetSummary[]> {
  const r = await getDatasetRecord(datasetId)
  const sets = [...(r.weightSets ?? [])]
  if (setIndex < 0 || setIndex >= sets.length) {
    throw appError('validation', `Weight set index out of range: ${setIndex}`)
  }
  const current = sets[setIndex]!
  const next = WeightSetConfigSchema.parse({
    prompt: patch.prompt ?? current.prompt,
    seed: patch.seed ?? current.seed,
    styleIndex: normalizeStyleIndex(patch.styleIndex ?? current.styleIndex),
    validationModel:
      patch.validationModel !== undefined
        ? patch.validationModel.trim() || 'Default'
        : current.validationModel?.trim() || 'Default',
    checkpointFileName:
      patch.checkpointFileName !== undefined
        ? patch.checkpointFileName?.trim() || null
        : current.checkpointFileName,
    weightMin: patch.weightMin ?? current.weightMin,
    weightMax: patch.weightMax ?? current.weightMax,
    weightStep: patch.weightStep ?? current.weightStep,
    existingCopyPolicy: patch.existingCopyPolicy ?? current.existingCopyPolicy
  })
  sets[setIndex] = next
  await writeRecord({ ...r, weightSets: sets })
  if (
    patch.weightMin !== undefined ||
    patch.weightMax !== undefined ||
    patch.weightStep !== undefined
  ) {
    await patchSettings({
      lastWeightRange: {
        weightMin: next.weightMin,
        weightMax: next.weightMax,
        weightStep: next.weightStep
      }
    })
  }
  return toSummaries(sets)
}

export async function removeWeightSet(
  datasetId: string,
  setIndex: number
): Promise<WeightSetSummary[]> {
  const r = await getDatasetRecord(datasetId)
  const sets = [...(r.weightSets ?? [])]
  if (sets.length <= 1) {
    throw appError('validation', 'Weight 1 cannot be removed — at least one weight set is required')
  }
  if (setIndex < 0 || setIndex >= sets.length) {
    throw appError('validation', `Weight set index out of range: ${setIndex}`)
  }

  const root = outputRoot(r.folderPath)
  await rm(setDir(r.folderPath, setIndex), { recursive: true, force: true })

  const oldCount = sets.length
  for (let k = setIndex + 2; k <= oldCount; k++) {
    const from = join(root, `Weight ${k}`)
    const to = join(root, `Weight ${k - 1}`)
    try {
      await stat(from)
      await rename(from, to)
    } catch {
      /* missing folder ok */
    }
  }

  sets.splice(setIndex, 1)
  await writeRecord({ ...r, weightSets: sets })
  await ensureSetFolders(r.folderPath, sets.length)
  broadcast({
    type: 'weight-previews-changed',
    payload: { datasetId, setIndex }
  })
  return listWeightSets(datasetId)
}

export async function clearWeightSetImages(
  datasetId: string,
  setIndex: number
): Promise<{ cleared: true; label: string }> {
  const { cancelWeightValidationIfActiveForDataset } = await import('./weightQueue')
  await cancelWeightValidationIfActiveForDataset(datasetId)
  const r = await getDatasetRecord(datasetId)
  const sets = r.weightSets ?? []
  if (setIndex < 0 || setIndex >= sets.length) {
    throw appError('validation', `Weight set index out of range: ${setIndex}`)
  }
  const dir = setDir(r.folderPath, setIndex)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const label = weightSetLabel(setIndex)
  broadcast({
    type: 'weight-previews-changed',
    payload: { datasetId, setIndex }
  })
  return { cleared: true, label }
}

export function weightSetOutputFolder(datasetFolder: string, setIndex: number): string {
  return setDir(datasetFolder, setIndex)
}

/** List existing previews in a weight set folder. */
export async function listWeightPreviews(
  datasetFolder: string,
  setIndex: number
): Promise<Array<{ stem: string; relativePath: string }>> {
  const dir = setDir(datasetFolder, setIndex)
  const label = weightSetLabel(setIndex)
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  const byStem = new Map<string, string>()
  for (const name of entries) {
    const m = /^(.*)\.(jpe?g|png|webp)$/i.exec(name)
    if (!m?.[1]) continue
    const stem = m[1]
    if (!byStem.has(stem)) byStem.set(stem, name)
  }
  return [...byStem.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([stem, fileName]) => ({
      stem,
      relativePath: `output/${label}/${fileName}`
    }))
}
