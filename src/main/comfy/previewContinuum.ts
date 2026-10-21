import { modelsMissingPreviews } from '@shared/stress-sets'
import {
  enumerateWeightSteps,
  weightsMissingPreviews
} from '@shared/weight-sets'
import { broadcast } from '../events/bus'
import { logger } from '../logging'
import { listDatasets, getDatasetRecord } from '../datasets/store'
import { listStressPreviews } from './stressSets'
import { listWeightPreviews } from './weightSets'

export type PreviewWorkKind = 'validation' | 'weight' | 'stress'

export type PreviewWorkItem = {
  datasetId: string
  kind: PreviewWorkKind
}

export type PreviewRunOutcome = 'done' | 'cancelled' | 'error'

/** Continuum active until cancelled or no unfinished preview work remains. */
let continuumActive = false
/** Skip work that already failed this continuum pass (avoid tight error loops). */
const skipped = new Set<string>()
/**
 * How many times we re-started the same dataset+kind after a clean `done`
 * (usually FS lag or an early multi-set exit). Capped so overnight runs cannot spin.
 */
const sameItemRestarts = new Map<string, number>()

const KIND_ORDER: PreviewWorkKind[] = ['validation', 'weight', 'stress']

function workKey(item: PreviewWorkItem): string {
  return `${item.kind}:${item.datasetId}`
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (
    err &&
    typeof err === 'object' &&
    'message' in err &&
    typeof (err as { message: unknown }).message === 'string'
  ) {
    return (err as { message: string }).message
  }
  return String(err)
}

function isBusyStartError(err: unknown): boolean {
  const msg = errorMessage(err).toLowerCase()
  return msg.includes('already in progress') || msg.includes('in progress —')
}

export function isPreviewContinuumActive(): boolean {
  return continuumActive
}

function broadcastContinuum(): void {
  broadcast({ type: 'preview-continuum', payload: { active: continuumActive } })
}

/** Call when the user starts Run from Validate / Weight / Stress (not chain follow-ups). */
export function beginPreviewContinuum(): void {
  continuumActive = true
  skipped.clear()
  sameItemRestarts.clear()
  broadcastContinuum()
}

/** Call on Stop / cancel so we do not auto-start the next dataset. */
export function stopPreviewContinuum(): void {
  if (!continuumActive) {
    skipped.clear()
    sameItemRestarts.clear()
    return
  }
  continuumActive = false
  skipped.clear()
  sameItemRestarts.clear()
  broadcastContinuum()
}

async function datasetNeedsValidation(datasetId: string, folderPath: string): Promise<boolean> {
  const r = await getDatasetRecord(datasetId)
  const setCount = Math.max(1, r.validationSets?.length ?? 0)
  try {
    const { getValidationSetsStatus } = await import('./nextValidationLora')
    const status = await getValidationSetsStatus(folderPath, setCount)
    return status.keepInComfyCount > 0 && !status.complete
  } catch {
    return false
  }
}

async function datasetNeedsWeight(datasetId: string, folderPath: string): Promise<boolean> {
  try {
    const r = await getDatasetRecord(datasetId)
    const sets = r.weightSets ?? []
    for (let i = 0; i < sets.length; i++) {
      const set = sets[i]!
      if (!set.checkpointFileName?.trim()) continue
      const enumerated = enumerateWeightSteps(set.weightMin, set.weightMax, set.weightStep)
      if (!enumerated.ok || enumerated.weights.length === 0) continue
      const previews = await listWeightPreviews(folderPath, i)
      const existing = new Set(previews.map((p) => p.stem.toLowerCase()))
      if (
        weightsMissingPreviews(set.checkpointFileName, enumerated.weights, existing)
          .length > 0
      ) {
        return true
      }
    }
  } catch (err) {
    logger.warn({ err, datasetId }, 'preview continuum: weight needs-check failed')
  }
  return false
}

async function datasetNeedsStress(datasetId: string, folderPath: string): Promise<boolean> {
  try {
    const r = await getDatasetRecord(datasetId)
    const sets = r.stressTestSets ?? []
    for (let i = 0; i < sets.length; i++) {
      const set = sets[i]!
      if (!set.checkpointFileName?.trim() || set.models.length === 0) continue
      const previews = await listStressPreviews(folderPath, i)
      const existing = new Set(previews.map((p) => p.stem.toLowerCase()))
      if (modelsMissingPreviews(set.models, existing).length > 0) return true
    }
  } catch (err) {
    logger.warn({ err, datasetId }, 'preview continuum: stress needs-check failed')
  }
  return false
}

/** Next tool in the per-dataset continuum order, or null after Stress. */
function nextPreviewKind(kind: PreviewWorkKind): PreviewWorkKind | null {
  const idx = KIND_ORDER.indexOf(kind)
  if (idx < 0 || idx >= KIND_ORDER.length - 1) return null
  return KIND_ORDER[idx + 1]!
}

async function datasetNeedsKind(
  kind: PreviewWorkKind,
  datasetId: string,
  folder: string
): Promise<boolean> {
  if (kind === 'validation') return datasetNeedsValidation(datasetId, folder)
  if (kind === 'weight') return datasetNeedsWeight(datasetId, folder)
  return datasetNeedsStress(datasetId, folder)
}

/**
 * Next unfinished preview job across trained datasets.
 * Order within a dataset: validation → weight → stress.
 */
export async function findNextPreviewWork(opts?: {
  preferDatasetId?: string | null
  preferKind?: PreviewWorkKind | null
}): Promise<PreviewWorkItem | null> {
  // Sidecar trained flags only — never kick off a full-library badge walk here.
  const summaries = await listDatasets({ deferBadges: true })
  const trained = summaries.filter((d) => d.trained)
  if (trained.length === 0) return null

  const preferId = opts?.preferDatasetId ?? null
  let ordered = trained
  if (preferId) {
    const idx = trained.findIndex((d) => d.id === preferId)
    if (idx > 0) {
      ordered = [...trained.slice(idx), ...trained.slice(0, idx)]
    }
  }

  const tryItem = async (item: PreviewWorkItem): Promise<PreviewWorkItem | null> => {
    if (skipped.has(workKey(item))) return null
    const folder = ordered.find((d) => d.id === item.datasetId)?.folderPath
    if (!folder) return null
    if (await datasetNeedsKind(item.kind, item.datasetId, folder)) return item
    return null
  }

  if (preferId && opts?.preferKind) {
    const hit = await tryItem({ datasetId: preferId, kind: opts.preferKind })
    if (hit) return hit
  }

  for (const ds of ordered) {
    for (const kind of KIND_ORDER) {
      const hit = await tryItem({ datasetId: ds.id, kind })
      if (hit) return hit
    }
  }
  return null
}

async function startPreviewWork(item: PreviewWorkItem): Promise<void> {
  if (item.kind === 'validation') {
    const { startValidation } = await import('./validationQueue')
    await startValidation({ datasetId: item.datasetId, chain: true })
  } else if (item.kind === 'weight') {
    const { startWeightValidation } = await import('./weightQueue')
    await startWeightValidation({ datasetId: item.datasetId, chain: true })
  } else {
    const { startStressTest } = await import('./stressQueue')
    await startStressTest({ datasetId: item.datasetId, chain: true })
  }
}

/**
 * After a validation/weight/stress run ends: if continuum is active, start the next
 * unfinished trained-dataset job.
 */
export async function onPreviewRunFinished(
  finished: PreviewWorkItem,
  outcome: PreviewRunOutcome
): Promise<void> {
  if (!continuumActive) return

  if (outcome === 'cancelled') {
    stopPreviewContinuum()
    return
  }

  if (outcome === 'error') {
    skipped.add(workKey(finished))
  }

  let preferDatasetId: string | null = finished.datasetId
  /**
   * After a clean finish, prefer the next tool on this dataset (Steps → Weight → Stress)
   * so a sticky Steps completeness check cannot starve Weight/Stress forever.
   */
  let preferKind: PreviewWorkKind | null =
    outcome === 'done' ? nextPreviewKind(finished.kind) : null
  let sameItemSettles = 0

  while (continuumActive) {
    await delay(750)
    if (!continuumActive) return

    let next: PreviewWorkItem | null = null
    try {
      next = await findNextPreviewWork({ preferDatasetId, preferKind })
      // preferKind is a one-shot hint for the first scan after a clean finish.
      preferKind = null
    } catch (err) {
      logger.warn({ err, finished }, 'preview continuum: find next failed')
      stopPreviewContinuum()
      return
    }

    if (!next) {
      logger.info({ finished }, 'preview continuum: no more unfinished work')
      stopPreviewContinuum()
      return
    }

    if (outcome === 'done' && workKey(next) === workKey(finished)) {
      if (sameItemSettles < 2) {
        sameItemSettles += 1
        logger.info(
          { next, sameItemSettles },
          'preview continuum: same work still incomplete — settling before recheck'
        )
        continue
      }
      const key = workKey(next)
      const restarts = sameItemRestarts.get(key) ?? 0
      if (restarts >= 1) {
        logger.warn({ next }, 'preview continuum: skipping sticky incomplete after re-run')
        skipped.add(key)
        sameItemSettles = 0
        continue
      }
      sameItemRestarts.set(key, restarts + 1)
      sameItemSettles = 0
    }

    logger.info({ finished, next }, 'preview continuum: starting next')

    try {
      await startPreviewWork(next)
      return
    } catch (err) {
      if (isBusyStartError(err)) {
        logger.warn({ err, next }, 'preview continuum: busy at handoff — retrying')
        await delay(500)
        if (!continuumActive) return
        try {
          await startPreviewWork(next)
          return
        } catch (err2) {
          logger.warn({ err: err2, next }, 'preview continuum: busy retry failed')
          skipped.add(workKey(next))
          preferDatasetId = next.datasetId
          continue
        }
      }
      logger.warn({ err, next }, 'preview continuum: failed to start next')
      skipped.add(workKey(next))
      preferDatasetId = next.datasetId
    }
  }
}
