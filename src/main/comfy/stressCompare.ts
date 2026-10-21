import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  orderStressCompareModels,
  orderStressCompareSets
} from '@shared/stress-compare'
import { modelPreviewStemMap, previewStemsForModel, stressTestSetLabel } from '@shared/stress-sets'
import { DatasetRecordSchema, type DatasetRecord } from '@shared/schemas/dataset'
import { getDatasetRecord } from '../datasets/store'
import { writeDatasetSidecar } from '../library/datasetSidecar'
import { listStressPreviews, listStressTestSets, stressTestSetOutputFolder } from './stressSets'

export type StressCompareColumn = {
  setIndex: number
  label: string
  /** ISO timestamp of newest preview (or folder mtime); used for default sort. */
  activityAt: string
}

export type StressCompareCell = {
  setIndex: number
  relativePath: string | null
}

export type StressCompareRow = {
  model: string
  collapsed: boolean
  cells: StressCompareCell[]
}

export type StressCompareGrid = {
  columns: StressCompareColumn[]
  rows: StressCompareRow[]
}

async function writeRecord(record: DatasetRecord): Promise<DatasetRecord> {
  const next = DatasetRecordSchema.parse({
    ...record,
    updatedAt: new Date().toISOString()
  })
  await writeDatasetSidecar(next.folderPath, next)
  return next
}

async function setActivityMs(folderPath: string): Promise<number> {
  try {
    const entries = await readdir(folderPath)
    let max = 0
    for (const name of entries) {
      if (!/\.(jpe?g|png|webp)$/i.test(name)) continue
      try {
        const s = await stat(join(folderPath, name))
        if (s.mtimeMs > max) max = s.mtimeMs
      } catch {
        /* skip */
      }
    }
    if (max > 0) return max
    const s = await stat(folderPath)
    return s.mtimeMs
  } catch {
    return 0
  }
}

/**
 * Map preview stems → relative paths for one set, keyed by model name when the
 * stem matches the set's model list; otherwise keyed by stem (orphan preview).
 */
function modelPathsForSet(
  models: readonly string[],
  previews: ReadonlyArray<{ stem: string; relativePath: string }>
): Map<string, string> {
  const byStemLower = new Map(
    previews.map((p) => [p.stem.toLowerCase(), p.relativePath] as const)
  )
  const stemByModel = modelPreviewStemMap([...models])
  const usedStems = new Set<string>()
  const out = new Map<string, string>()

  for (const model of models) {
    const stem = stemByModel.get(model)
    if (!stem) continue
    let path: string | undefined
    let matchedStem: string | undefined
    for (const candidate of previewStemsForModel(model, stem)) {
      path = byStemLower.get(candidate.toLowerCase())
      if (path) {
        matchedStem = candidate.toLowerCase()
        break
      }
    }
    if (!path || !matchedStem) continue
    out.set(model, path)
    usedStems.add(matchedStem)
  }

  for (const p of previews) {
    if (usedStems.has(p.stem.toLowerCase())) continue
    out.set(p.stem, p.relativePath)
  }

  return out
}

/** Build the comparison grid; rows are only models with ≥1 produced image. */
export async function getStressCompareGrid(datasetId: string): Promise<StressCompareGrid> {
  const record = await getDatasetRecord(datasetId)
  const sets = await listStressTestSets(datasetId)

  const setMeta: Array<{
    setIndex: number
    label: string
    activityMs: number
    paths: Map<string, string>
  }> = []

  for (const s of sets) {
    const folder = stressTestSetOutputFolder(record.folderPath, s.index)
    const [previews, activityMs] = await Promise.all([
      listStressPreviews(record.folderPath, s.index),
      setActivityMs(folder)
    ])
    setMeta.push({
      setIndex: s.index,
      label: s.label || stressTestSetLabel(s.index),
      activityMs,
      paths: modelPathsForSet(s.models ?? [], previews)
    })
  }

  const modelsWithImages = new Set<string>()
  for (const s of setMeta) {
    for (const model of s.paths.keys()) modelsWithImages.add(model)
  }

  const extrasSorted = [...modelsWithImages].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  )
  const modelOrder = orderStressCompareModels(
    [...modelsWithImages],
    record.stressCompareModelOrder ?? [],
    extrasSorted
  )

  const columnOrder = orderStressCompareSets(
    setMeta.map((s) => ({ setIndex: s.setIndex, activityMs: s.activityMs })),
    record.stressCompareSetOrder ?? []
  )
  const byIndex = new Map(setMeta.map((s) => [s.setIndex, s] as const))
  const columns: StressCompareColumn[] = columnOrder.map((setIndex) => {
    const s = byIndex.get(setIndex)!
    return {
      setIndex,
      label: s.label,
      activityAt: new Date(s.activityMs || 0).toISOString()
    }
  })

  const collapsed = new Set(record.stressCompareCollapsedModels ?? [])
  const rows: StressCompareRow[] = modelOrder.map((model) => ({
    model,
    collapsed: collapsed.has(model),
    cells: columns.map((col) => ({
      setIndex: col.setIndex,
      relativePath: byIndex.get(col.setIndex)?.paths.get(model) ?? null
    }))
  }))

  return { columns, rows }
}

export async function updateStressCompareLayout(
  datasetId: string,
  patch: {
    modelOrder?: string[]
    setOrder?: number[]
    collapsedModels?: string[]
  }
): Promise<StressCompareGrid> {
  const r = await getDatasetRecord(datasetId)
  await writeRecord({
    ...r,
    ...(patch.modelOrder !== undefined ? { stressCompareModelOrder: [...patch.modelOrder] } : {}),
    ...(patch.setOrder !== undefined ? { stressCompareSetOrder: [...patch.setOrder] } : {}),
    ...(patch.collapsedModels !== undefined
      ? { stressCompareCollapsedModels: [...patch.collapsedModels] }
      : {})
  })
  return getStressCompareGrid(datasetId)
}
