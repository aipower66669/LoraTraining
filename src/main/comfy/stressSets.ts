import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { appError } from '@shared/errors'
import {
  defaultStressTestSetConfig,
  stressTestSetFromPrevious,
  stressTestSetLabel,
  StressTestSetConfigSchema,
  type StressTestSetConfig
} from '@shared/stress-sets'
import { remapStressCompareSetOrderAfterRemove } from '@shared/stress-compare'
import { normalizeStyleIndex } from '@shared/validation-sets'
import { getDatasetRecord } from '../datasets/store'
import { broadcast } from '../events/bus'
import { loadSettings, patchSettings } from '../settings/store'
import { DatasetRecordSchema, type DatasetRecord } from '@shared/schemas/dataset'
import { writeDatasetSidecar } from '../library/datasetSidecar'

async function firstStressTestSetConfig(): Promise<StressTestSetConfig> {
  const settings = await loadSettings()
  const prompt = settings.lastValidationPrompt.trim()
  const models = settings.lastStressModels ?? []
  return defaultStressTestSetConfig({
    ...(prompt ? { prompt } : {}),
    ...(models.length > 0 ? { models: [...models] } : {})
  })
}

function outputRoot(folderPath: string): string {
  return join(folderPath.replace(/[/\\]+$/, ''), 'output')
}

function setDir(folderPath: string, index: number): string {
  return join(outputRoot(folderPath), stressTestSetLabel(index))
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

export interface StressTestSetSummary extends StressTestSetConfig {
  index: number
  label: string
}

function toSummaries(sets: StressTestSetConfig[]): StressTestSetSummary[] {
  return sets.map((s, index) => ({
    ...s,
    index,
    label: stressTestSetLabel(index)
  }))
}

/** List sets; creates Stress 1 if the dataset has none yet. */
export async function listStressTestSets(datasetId: string): Promise<StressTestSetSummary[]> {
  const r = await getDatasetRecord(datasetId)
  let sets = r.stressTestSets ?? []
  if (sets.length === 0) {
    sets = [await firstStressTestSetConfig()]
    await writeRecord({ ...r, stressTestSets: sets })
    await ensureSetFolders(r.folderPath, 1)
  } else {
    await ensureSetFolders(r.folderPath, sets.length)
  }
  return toSummaries(sets)
}

export async function addStressTestSet(datasetId: string): Promise<StressTestSetSummary[]> {
  const r = await getDatasetRecord(datasetId)
  const sets = [...(r.stressTestSets ?? [])]
  if (sets.length === 0) {
    sets.push(await firstStressTestSetConfig())
  } else {
    const settings = await loadSettings()
    const globalModels = settings.lastStressModels ?? []
    const cloned = stressTestSetFromPrevious(sets[sets.length - 1]!)
    // Prefer last Select models… Apply over the previous set’s list when set.
    sets.push(
      globalModels.length > 0
        ? StressTestSetConfigSchema.parse({ ...cloned, models: [...globalModels] })
        : cloned
    )
  }
  await writeRecord({ ...r, stressTestSets: sets })
  await ensureSetFolders(r.folderPath, sets.length)
  return toSummaries(sets)
}

export async function updateStressTestSet(
  datasetId: string,
  setIndex: number,
  patch: Partial<StressTestSetConfig>
): Promise<StressTestSetSummary[]> {
  const r = await getDatasetRecord(datasetId)
  const sets = [...(r.stressTestSets ?? [])]
  if (setIndex < 0 || setIndex >= sets.length) {
    throw appError('validation', `Stress set index out of range: ${setIndex}`)
  }
  const current = sets[setIndex]!
  const models =
    patch.models !== undefined
      ? [...new Set(patch.models.map((m) => m.trim()).filter(Boolean))]
      : current.models
  sets[setIndex] = StressTestSetConfigSchema.parse({
    prompt: patch.prompt ?? current.prompt,
    seed: patch.seed ?? current.seed,
    loraWeight: patch.loraWeight ?? current.loraWeight,
    styleIndex: normalizeStyleIndex(patch.styleIndex ?? current.styleIndex),
    models,
    checkpointFileName:
      patch.checkpointFileName !== undefined
        ? patch.checkpointFileName?.trim() || null
        : current.checkpointFileName,
    existingCopyPolicy: patch.existingCopyPolicy ?? current.existingCopyPolicy
  })
  await writeRecord({ ...r, stressTestSets: sets })
  if (patch.models !== undefined) {
    // Always remember Apply as the global default (including empty = clear default).
    await patchSettings({ lastStressModels: models })
  }
  return toSummaries(sets)
}

export async function removeStressTestSet(
  datasetId: string,
  setIndex: number
): Promise<StressTestSetSummary[]> {
  const r = await getDatasetRecord(datasetId)
  const sets = [...(r.stressTestSets ?? [])]
  if (sets.length <= 1) {
    throw appError('validation', 'Stress 1 cannot be removed — at least one stress set is required')
  }
  if (setIndex < 0 || setIndex >= sets.length) {
    throw appError('validation', `Stress set index out of range: ${setIndex}`)
  }

  const root = outputRoot(r.folderPath)
  await rm(setDir(r.folderPath, setIndex), { recursive: true, force: true })

  const oldCount = sets.length
  for (let k = setIndex + 2; k <= oldCount; k++) {
    const from = join(root, `Stress ${k}`)
    const to = join(root, `Stress ${k - 1}`)
    try {
      await stat(from)
      await rename(from, to)
    } catch {
      /* missing folder ok */
    }
  }

  sets.splice(setIndex, 1)
  await writeRecord({
    ...r,
    stressTestSets: sets,
    stressCompareSetOrder: remapStressCompareSetOrderAfterRemove(
      r.stressCompareSetOrder ?? [],
      setIndex
    )
  })
  await ensureSetFolders(r.folderPath, sets.length)
  broadcast({
    type: 'stress-previews-changed',
    payload: { datasetId, setIndex }
  })
  return listStressTestSets(datasetId)
}

export async function clearStressTestSetImages(
  datasetId: string,
  setIndex: number
): Promise<{ cleared: true; label: string }> {
  const { cancelStressTestIfActiveForDataset } = await import('./stressQueue')
  await cancelStressTestIfActiveForDataset(datasetId)
  const r = await getDatasetRecord(datasetId)
  const sets = r.stressTestSets ?? []
  if (setIndex < 0 || setIndex >= sets.length) {
    throw appError('validation', `Stress set index out of range: ${setIndex}`)
  }
  const dir = setDir(r.folderPath, setIndex)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const label = stressTestSetLabel(setIndex)
  broadcast({
    type: 'stress-previews-changed',
    payload: { datasetId, setIndex }
  })
  return { cleared: true, label }
}

export function stressTestSetOutputFolder(datasetFolder: string, setIndex: number): string {
  return setDir(datasetFolder, setIndex)
}

/** List existing previews in a stress set folder. */
export async function listStressPreviews(
  datasetFolder: string,
  setIndex: number
): Promise<Array<{ stem: string; relativePath: string; modelHint: string }>> {
  const dir = setDir(datasetFolder, setIndex)
  const label = stressTestSetLabel(setIndex)
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
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([stem, fileName]) => ({
      stem,
      relativePath: `output/${label}/${fileName}`,
      modelHint: stem
    }))
}

/** @deprecated prefer listStressPreviews */
export async function listStressPreviewStems(
  datasetFolder: string,
  setIndex: number
): Promise<string[]> {
  return (await listStressPreviews(datasetFolder, setIndex)).map((p) => p.stem)
}
