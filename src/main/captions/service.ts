import { readFile, unlink } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { applyBulkOp, hasTrigger } from '@shared/captions/transforms'
import type { BulkOp, BulkTransformResult } from '@shared/ipc/contract'
import {
  isTrainingSafeImageExt,
  type CaptionValidationIssue,
  type CaptionValidationReport
} from '@shared/caption-validation'
import { datasetHasQueuedJob } from '@shared/dataset-jobs'
import { isAtLeastReady } from '@shared/explorer-status'
import { appError } from '@shared/errors'
import { broadcast } from '../events/bus'
import { atomicWriteFile } from '../security/atomic-write'
import { assertInsideRoot } from '../security/path-guards'
import { getDatasetRecord, listDatasets, scanFolder } from '../datasets/store'
import { mapWithConcurrency } from '../util/concurrency'
import { listJobs } from '../jobs/store'
import { listCategories } from '../categories/store'

/** Bounded so bulk caption transforms don't serialize hundreds of read+write round trips. */
const BULK_TRANSFORM_CONCURRENCY = 8

function formatBulkProgress(done: number, total: number): string {
  if (total <= 0) return 'Updating captions…'
  const pct = Math.min(100, Math.round((done / total) * 100))
  return `Updating captions ${done}/${total} (${pct}%)`
}

function captionPathFor(folderPath: string, fileName: string, captionExt: string): string {
  const stem = basename(fileName, extname(fileName))
  return join(folderPath, `${stem}.${captionExt}`)
}

export async function getCaption(
  datasetId: string,
  fileName: string
): Promise<{ text: string | null }> {
  const ds = await getDatasetRecord(datasetId)
  const full = assertInsideRoot(ds.folderPath, join(ds.folderPath, fileName))
  const cap = captionPathFor(ds.folderPath, basename(full), ds.captionExt)
  assertInsideRoot(ds.folderPath, cap)
  try {
    const text = await readFile(cap, 'utf8')
    return { text }
  } catch {
    return { text: null }
  }
}

export async function setCaption(
  datasetId: string,
  fileName: string,
  text: string
): Promise<{ saved: true }> {
  const ds = await getDatasetRecord(datasetId)
  const full = assertInsideRoot(ds.folderPath, join(ds.folderPath, fileName))
  const cap = captionPathFor(ds.folderPath, basename(full), ds.captionExt)
  assertInsideRoot(ds.folderPath, cap)
  try {
    const { muteDatasetFolderWatch } = await import('../datasets/folderWatch')
    muteDatasetFolderWatch(1500)
  } catch {
    /* optional */
  }
  await atomicWriteFile(cap, text)
  return { saved: true }
}

/** Delete the sibling `.txt` so JoyCaption “only missing” will pick the image up again. */
export async function clearCaption(
  datasetId: string,
  fileName: string
): Promise<{ cleared: boolean }> {
  const ds = await getDatasetRecord(datasetId)
  const full = assertInsideRoot(ds.folderPath, join(ds.folderPath, fileName))
  const cap = captionPathFor(ds.folderPath, basename(full), ds.captionExt)
  assertInsideRoot(ds.folderPath, cap)
  try {
    const { muteDatasetFolderWatch } = await import('../datasets/folderWatch')
    muteDatasetFolderWatch(1500)
  } catch {
    /* optional */
  }
  try {
    await unlink(cap)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    if (code === 'ENOENT') return { cleared: false }
    throw err
  }
  try {
    const { rescanDataset } = await import('../datasets/store')
    await rescanDataset(datasetId)
  } catch {
    /* best-effort stats refresh */
  }
  return { cleared: true }
}

export async function bulkTransform(input: {
  datasetId: string
  op: BulkOp
  dryRun?: boolean
  createMissing?: boolean
}): Promise<BulkTransformResult> {
  const ds = await getDatasetRecord(input.datasetId)
  const { images } = await scanFolder(ds.folderPath, ds.captionExt)
  const dryRun = Boolean(input.dryRun)
  const runId = `bulk-caption-${input.datasetId}`
  const total = images.length

  const createMissing =
    input.createMissing ||
    (input.op.op === 'prefix' || input.op.op === 'suffix'
      ? Boolean(input.op.createMissing)
      : input.op.op === 'ensureTrigger' || input.op.op === 'setText')

  type PerImageResult =
    | { fileName: string; skipped: true }
    | { fileName: string; skipped: false; before: string; after: string }

  if (!dryRun && total > 0) {
    broadcast({
      type: 'tool-run-updated',
      payload: { runId, status: 'running', message: formatBulkProgress(0, total) }
    })
  }

  // done/index bookkeeping happens synchronously between awaits inside each
  // worker below, so incrementing this shared counter from concurrent workers
  // is safe (no interleaving can occur mid-increment in JS).
  let done = 0

  // Bounded concurrency: each image is an independent read (+ maybe write), so
  // running them one at a time serializes hundreds of round trips — very slow
  // on a network-mounted library.
  const perImage = await mapWithConcurrency(
    images,
    BULK_TRANSFORM_CONCURRENCY,
    async (img): Promise<PerImageResult> => {
      const capPath = join(ds.folderPath, `${img.stem}.${ds.captionExt}`)
      assertInsideRoot(ds.folderPath, capPath)
      let current: string | null = null
      try {
        current = await readFile(capPath, 'utf8')
      } catch {
        current = null
      }

      const finish = (result: PerImageResult): PerImageResult => {
        done++
        if (!dryRun && (done === total || done % 5 === 0)) {
          broadcast({
            type: 'tool-run-updated',
            payload: { runId, status: 'running', message: formatBulkProgress(done, total) }
          })
        }
        return result
      }

      if (current === null && !createMissing && input.op.op !== 'ensureTrigger' && input.op.op !== 'setText') {
        return finish({ fileName: img.fileName, skipped: true })
      }

      const result = applyBulkOp(
        current,
        input.op,
        input.op.op === 'ensureTrigger' ||
          input.op.op === 'stripTrigger' ||
          input.op.op === 'setText'
          ? (input.op.trigger ?? ds.trigger)
          : ds.trigger
      )
      if (!result.changed) {
        return finish({ fileName: img.fileName, skipped: true })
      }
      if (
        result.create &&
        !createMissing &&
        input.op.op !== 'ensureTrigger' &&
        input.op.op !== 'setText'
      ) {
        return finish({ fileName: img.fileName, skipped: true })
      }

      if (!dryRun && result.text !== null) {
        await atomicWriteFile(capPath, result.text)
      }
      return finish({
        fileName: img.fileName,
        skipped: false,
        before: current ?? '',
        after: result.text ?? ''
      })
    }
  )

  let changed = 0
  let skipped = 0
  const samples: BulkTransformResult['samples'] = []
  for (const r of perImage) {
    if (r.skipped) {
      skipped++
      continue
    }
    changed++
    if (samples.length < 3) {
      samples.push({ fileName: r.fileName, before: r.before, after: r.after })
    }
  }

  if (images.length === 0) {
    throw appError('folder-missing', 'Dataset folder has no images', {
      remediation: 'Check the folder path and rescan.'
    })
  }

  if (!dryRun && total > 0) {
    broadcast({
      type: 'tool-run-updated',
      payload: {
        runId,
        status: 'complete',
        message: `Updated ${changed} caption${changed === 1 ? '' : 's'}${skipped ? ` · ${skipped} skipped` : ''}`
      }
    })
  }

  // Refresh sidecar + detail-cache stats so Create Job / Ready gating see new captions.
  if (!dryRun && changed > 0) {
    try {
      const { rescanDataset } = await import('../datasets/store')
      await rescanDataset(input.datasetId)
    } catch {
      /* best-effort */
    }
  }

  return { changed, skipped, dryRun, samples }
}

/**
 * Scan every Ready-or-higher dataset for training caption issues:
 * JPG/PNG only, caption present, trigger present in each caption.
 */
export async function validateReadyCaptions(): Promise<CaptionValidationReport> {
  const runId = `caption-validate-${Date.now()}`
  const [summaries, jobs, categories] = await Promise.all([
    listDatasets(),
    listJobs(),
    listCategories()
  ])
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name] as const))
  const issues: CaptionValidationIssue[] = []
  let skippedNotReady = 0

  const readySummaries: typeof summaries = []
  for (const summary of summaries) {
    const inQueue = datasetHasQueuedJob(jobs, summary.id)
    if (!isAtLeastReady(summary, inQueue)) {
      skippedNotReady++
      continue
    }
    readySummaries.push(summary)
  }

  const total = readySummaries.length
  broadcast({
    type: 'tool-run-updated',
    payload: {
      runId,
      status: 'running',
      message:
        total === 0
          ? 'No Ready+ datasets to check'
          : `Validating captions… 0/${total}`
    }
  })

  let checkedDatasets = 0
  for (const summary of readySummaries) {
    checkedDatasets++
    broadcast({
      type: 'tool-run-updated',
      payload: {
        runId,
        status: 'running',
        message: `Validating captions… ${checkedDatasets}/${total} · ${summary.name}`
      }
    })

    let record
    try {
      record = await getDatasetRecord(summary.id)
    } catch {
      continue
    }

    const trigger = (record.trigger ?? '').trim()
    const categoryName = categoryNameById.get(summary.categoryId)?.trim() || 'Uncategorized'

    if (!trigger) {
      issues.push({
        kind: 'empty-trigger',
        datasetId: summary.id,
        datasetName: summary.name,
        categoryName,
        fileName: null,
        message: `“${summary.name}” has no trigger word`
      })
    }

    let images: Awaited<ReturnType<typeof scanFolder>>['images']
    try {
      ;({ images } = await scanFolder(record.folderPath, record.captionExt))
    } catch {
      continue
    }

    for (const img of images) {
      const ext = extname(img.fileName).toLowerCase()
      if (!isTrainingSafeImageExt(ext)) {
        issues.push({
          kind: 'bad-extension',
          datasetId: summary.id,
          datasetName: summary.name,
          categoryName,
          fileName: img.fileName,
          message: `${img.fileName} — use .jpg or .png (not ${ext || 'unknown'})`
        })
      }

      if (!img.captionExists) {
        issues.push({
          kind: 'missing-caption',
          datasetId: summary.id,
          datasetName: summary.name,
          categoryName,
          fileName: img.fileName,
          message: `${img.fileName} — missing caption`
        })
        continue
      }

      if (!trigger) continue

      const capPath = captionPathFor(record.folderPath, img.fileName, record.captionExt)
      let text: string
      try {
        text = await readFile(assertInsideRoot(record.folderPath, capPath), 'utf8')
      } catch {
        issues.push({
          kind: 'missing-caption',
          datasetId: summary.id,
          datasetName: summary.name,
          categoryName,
          fileName: img.fileName,
          message: `${img.fileName} — missing caption`
        })
        continue
      }

      if (!hasTrigger(text, trigger)) {
        issues.push({
          kind: 'missing-trigger',
          datasetId: summary.id,
          datasetName: summary.name,
          categoryName,
          fileName: img.fileName,
          message: `${img.fileName} — caption missing trigger “${trigger}”`
        })
      }
    }
  }

  issues.sort((a, b) => {
    const byCat = a.categoryName.localeCompare(b.categoryName)
    if (byCat !== 0) return byCat
    const byDs = a.datasetName.localeCompare(b.datasetName)
    if (byDs !== 0) return byDs
    return (a.fileName ?? '').localeCompare(b.fileName ?? '')
  })

  const report: CaptionValidationReport = {
    checkedDatasets,
    skippedNotReady,
    issueCount: issues.length,
    issues
  }

  const datasetsWithIssues = new Set(issues.map((i) => i.datasetId)).size
  const summaryMsg =
    total === 0
      ? 'No Ready+ datasets to check'
      : issues.length === 0
        ? `Captions OK · ${checkedDatasets} Ready+ dataset${checkedDatasets === 1 ? '' : 's'}${
            skippedNotReady ? ` · skipped ${skippedNotReady} not ready` : ''
          }`
        : `${issues.length} caption issue${issues.length === 1 ? '' : 's'} in ${datasetsWithIssues} dataset${
            datasetsWithIssues === 1 ? '' : 's'
          } · checked ${checkedDatasets} Ready+`

  broadcast({
    type: 'tool-run-updated',
    payload: { runId, status: 'complete', message: summaryMsg }
  })

  return report
}
