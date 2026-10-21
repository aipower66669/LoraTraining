import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, unlink } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { UpscaleProgress, UpscaleRunConfig } from '@shared/comfy'
import { DEFAULT_UPSCALE_PROGRESS } from '@shared/comfy'
import { formatComfyConnectError, isComfyUnreachableError } from '@shared/comfy'
import { upscaleOutputStem } from '@shared/upscale-filename'
import type { UpscaleConfig } from '@shared/upscale-config'
import { resolveValidationModel } from '@shared/validation-model'
import { imageStem, IMAGE_EXTENSIONS } from '@shared/schemas/dataset'
import { libraryUpscaleTmpDir } from '@shared/library-paths'
import { appError } from '@shared/errors'
import type { AppSettings } from '@shared/schemas/settings'
import { broadcast } from '../events/bus'
import { getDatasetRecord, scanFolder } from '../datasets/store'
import { getLibraryRoot, loadSettings } from '../settings/store'
import { assertInsideRoot } from '../security/path-guards'
import { reencodeToExtension } from '../media/reencode'
import {
  getImageEditStateAtPath,
  revertImageOriginal,
  writeEncodedImageBytes
} from '../images/imageEdit'
import { ComfyAdapter, type ExecutionEvent } from './adapter'
import { formatComfyProgressLine, resolveWorkflowNodeTitle } from './comfyProgress'
import { injectUpscaleInputs } from './injectUpscaleInputs'
import { readInjectedLtSeed } from './injectValidationInputs'
import { getUpscaleImageConfig } from './upscaleImageConfig'
import { upscaleWorkflowStore, type WorkflowGraph, type WorkflowProfile } from './workflowStore'

// Independent module-level lock/state — Upscale runs never block, and are never
// blocked by, Validation runs (see D-decision: "independent" concurrency).
let cancelled = false
let running = false
let runningFileName: string | null = null
let progress: UpscaleProgress = { ...DEFAULT_UPSCALE_PROGRESS }

const RESULT_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp']

function emit(): void {
  broadcast({ type: 'upscale-progress', payload: progress })
}

function setProgress(patch: Partial<UpscaleProgress>): void {
  progress = { ...progress, ...patch }
  emit()
}

export function getUpscaleProgress(): UpscaleProgress {
  return progress
}

export function isUpscaleRunning(datasetId: string, fileName: string): boolean {
  return running && progress.datasetId === datasetId && runningFileName === fileName
}

export async function cancelUpscale(): Promise<{ cancelled: true }> {
  cancelled = true
  try {
    const settings = await loadSettings()
    const adapter = new ComfyAdapter(settings.comfy)
    await adapter.interrupt()
  } catch {
    /* ignore */
  }
  if (running) {
    setProgress({ status: 'cancelled', lastMessage: 'Cancelled' })
  }
  return { cancelled: true }
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0
}

/** Guard against traversal / non-image filenames, mirroring `deleteDatasetImage`. */
function assertValidImageFileName(fileName: string): string {
  const base = basename(fileName)
  if (base !== fileName || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    throw appError('validation', 'Invalid image file name')
  }
  const ext = extname(base).toLowerCase()
  if (!IMAGE_EXTENSIONS.has(ext)) {
    throw appError('validation', `Not an image file: ${base}`)
  }
  return base
}

/** Duplicated from validationQueue.ts's waitForPrompt (own module, own lock — see plan). */
async function waitForPrompt(
  adapter: ComfyAdapter,
  clientId: string,
  promptId: string,
  workflow: WorkflowGraph,
  onComfyProgress: (patch: Partial<UpscaleProgress>) => void
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false
    let nodeTitle: string | null = null
    let step: number | null = null
    let max: number | null = null
    let detail: string | null = null

    const push = (): void => {
      const line = formatComfyProgressLine({ nodeTitle, step, max, detail })
      onComfyProgress({
        comfyNodeTitle: nodeTitle,
        comfyStep: step,
        comfyMax: max,
        comfyDetail: detail,
        lastMessage: line || undefined
      })
    }

    const finish = (err?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      dispose()
      if (err) reject(err)
      else resolve()
    }
    const timer = setTimeout(
      () => finish(new Error('ComfyUI execution timed out (10 min)')),
      10 * 60 * 1000
    )
    const dispose = adapter.monitor(clientId, (event: ExecutionEvent) => {
      if (cancelled) {
        finish(new Error('cancelled'))
        return
      }
      if (event.type === 'execution_error' && event.promptId === promptId) {
        finish(new Error(event.message || 'ComfyUI execution error'))
        return
      }
      if (event.type === 'executing' && (!event.promptId || event.promptId === promptId)) {
        if (event.nodeId == null) {
          return
        }
        nodeTitle = resolveWorkflowNodeTitle(workflow, event.nodeId) ?? event.nodeId
        detail = null
        push()
        return
      }
      if (
        (event.type === 'progress' || event.type === 'progress_state') &&
        (!event.promptId || event.promptId === promptId)
      ) {
        step = event.value
        max = event.max
        if (event.nodeId) {
          nodeTitle = resolveWorkflowNodeTitle(workflow, event.nodeId) ?? nodeTitle ?? event.nodeId
        }
        push()
        return
      }
      if (event.type === 'progress_text' && (!event.promptId || event.promptId === promptId)) {
        detail = event.text
        if (event.nodeId) {
          nodeTitle = resolveWorkflowNodeTitle(workflow, event.nodeId) ?? nodeTitle ?? event.nodeId
        }
        push()
      }
    })
    const poll = async (): Promise<void> => {
      while (!settled) {
        if (cancelled) {
          finish(new Error('cancelled'))
          return
        }
        try {
          const hist = await adapter.getHistory(promptId)
          if (hist) {
            const status = hist['status'] as { status_str?: string; messages?: unknown } | undefined
            if (status?.status_str === 'error') {
              const msg = JSON.stringify(status.messages ?? status)
              finish(new Error(msg))
              return
            }
            finish()
            return
          }
        } catch {
          /* retry */
        }
        await new Promise((r) => setTimeout(r, 500))
      }
    }
    void poll()
  })
}

/** Find `{baseStem}_upscaled.{ext}` in `folder`, trying known image extensions. */
async function findResultFile(folder: string, baseStem: string): Promise<string | null> {
  const targetStem = upscaleOutputStem(baseStem)
  let entries: string[] = []
  try {
    entries = await readdir(folder)
  } catch {
    return null
  }
  const targetLower = targetStem.toLowerCase()
  for (const ext of RESULT_EXTENSIONS) {
    const exact = entries.find((f) => f.toLowerCase() === `${targetLower}${ext}`)
    if (exact) return join(folder, exact)
  }
  // Fallback: some save nodes append a numeric counter (e.g. `_00001_`).
  const prefixed = entries
    .filter((f) => {
      const lower = f.toLowerCase()
      return (
        lower.startsWith(targetLower) &&
        RESULT_EXTENSIONS.some((ext) => lower.endsWith(ext))
      )
    })
    .sort()
  return prefixed.length > 0 ? join(folder, prefixed[prefixed.length - 1]!) : null
}

async function waitForResultFile(
  folder: string,
  baseStem: string,
  timeoutMs = 15_000
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = await findResultFile(folder, baseStem)
    if (found) return found
    if (Date.now() >= deadline) return null
    await new Promise((r) => setTimeout(r, 300))
  }
}

/**
 * With NTFS versions enabled, write the upscale result as the next tip ADS.
 * Otherwise overwrite the image body in place.
 */
async function swapInUpscaleResult(
  folderPath: string,
  fileName: string,
  rawResultPath: string,
  imageVersionsEnabled: boolean
): Promise<{ versionCount: number }> {
  const destPath = assertInsideRoot(folderPath, join(folderPath, fileName))
  const rawBuffer = await readFile(rawResultPath)
  const converted = await reencodeToExtension(rawBuffer, fileName)
  const result = await writeEncodedImageBytes(destPath, converted, imageVersionsEnabled)
  await unlink(rawResultPath).catch(() => undefined)
  return { versionCount: result.versionCount }
}

async function runOneUpscaleJob(opts: {
  datasetId: string
  fileName: string
  folderPath: string
  config: UpscaleConfig
  profile: WorkflowProfile
  adapter: ComfyAdapter
  settings: AppSettings
  batchIndex: number | null
  batchTotal: number | null
}): Promise<void> {
  const { datasetId, fileName, folderPath, config, profile, adapter, settings } = opts
  const currentPath = assertInsideRoot(folderPath, join(folderPath, fileName))
  const editState = await getImageEditStateAtPath(currentPath)
  const hadVersionsBefore = editState.hasVersions
  // Always re-derive from pristine `$DATA` so "Try again" never compounds tip edits.
  const sourceImagePath = currentPath

  const seedRaw = Number(config.seed)
  const seed = !Number.isFinite(seedRaw) || seedRaw <= 0 ? randomSeed() : Math.floor(seedRaw)
  const sourceStem = imageStem(fileName)
  const tmpDir = libraryUpscaleTmpDir(getLibraryRoot())

  const runConfig: UpscaleRunConfig = {
    datasetId,
    fileName,
    sourceImagePath,
    prompt: config.prompt,
    seed,
    model: resolveValidationModel(config.model, settings.comfy.defaultValidationModel),
    denoise: config.denoise,
    styleIndex: config.styleIndex === 1 ? 1 : 0,
    maxSize: config.maxSize
  }

  runningFileName = fileName
  const batchLabel =
    opts.batchTotal != null && opts.batchIndex != null
      ? ` (${opts.batchIndex}/${opts.batchTotal})`
      : ''
  setProgress({
    status: 'running',
    datasetId,
    fileName,
    batchIndex: opts.batchIndex,
    batchTotal: opts.batchTotal,
    lastMessage: `Starting upscale${batchLabel} (seed ${seed})…`,
    error: undefined,
    hasOriginal: hadVersionsBefore,
    comfyNodeTitle: null,
    comfyStep: null,
    comfyMax: null,
    comfyDetail: null
  })

  await mkdir(tmpDir, { recursive: true })
  const graph = injectUpscaleInputs(profile.workflow, runConfig, seed, tmpDir, sourceStem)
  const verified = readInjectedLtSeed(graph)
  if (verified !== seed) {
    throw appError(
      'upscale',
      `Failed to inject seed into LT · Seed (wanted ${seed}, graph has ${String(verified)}). Re-save the workflow after updating comfyui-lora-training.`
    )
  }

  const clientId = randomUUID()
  const queued = await adapter.queuePrompt(graph, clientId, { uiWorkflow: profile.uiWorkflow })
  await waitForPrompt(adapter, clientId, queued.promptId, graph, (patch) => {
    const line = patch.lastMessage
    const withBatch =
      line && opts.batchTotal != null && opts.batchIndex != null
        ? `${line} · ${opts.batchIndex}/${opts.batchTotal}`
        : line
    setProgress({ ...patch, lastMessage: withBatch ?? patch.lastMessage })
  })
  if (cancelled) {
    throw new Error('cancelled')
  }

  const rawResultPath = await waitForResultFile(tmpDir, sourceStem)
  if (!rawResultPath) {
    throw new Error(
      `ComfyUI finished but no “${upscaleOutputStem(sourceStem)}” result appeared in ${tmpDir}.`
    )
  }

  const saved = await swapInUpscaleResult(
    folderPath,
    fileName,
    rawResultPath,
    settings.imageVersionsEnabled
  )

  const { invalidateDatasetThumb } = await import('../media/thumbs')
  await invalidateDatasetThumb(datasetId, fileName, folderPath)

  const isBatchLast =
    opts.batchTotal == null ||
    opts.batchIndex == null ||
    opts.batchIndex >= opts.batchTotal

  setProgress({
    // Stay `running` between batch images so Stop remains available.
    status: isBatchLast ? 'done' : 'running',
    lastMessage:
      opts.batchTotal != null && opts.batchIndex != null
        ? `Done · ${fileName} (${opts.batchIndex}/${opts.batchTotal})`
        : `Done · ${fileName}`,
    error: undefined,
    hasOriginal: saved.versionCount > 0,
    comfyNodeTitle: null,
    comfyStep: null,
    comfyMax: null,
    comfyDetail: null
  })

  broadcast({ type: 'dataset-folder-changed', payload: { datasetId } })
}

function handleUpscaleRunError(err: unknown, settings: AppSettings): void {
  let message = err instanceof Error ? err.message : String(err)
  if (message === 'cancelled' || cancelled) {
    setProgress({ status: 'cancelled', lastMessage: 'Cancelled' })
    return
  }
  if (isComfyUnreachableError(err) || message === 'fetch failed') {
    message = formatComfyConnectError(settings.comfy, err)
  }
  setProgress({ status: 'error', error: message, lastMessage: message })
}

export async function startUpscale(input: {
  datasetId: string
  fileName: string
}): Promise<{ started: true }> {
  if (running) {
    throw appError('busy', 'An upscale run is already in progress.')
  }
  const fileName = assertValidImageFileName(input.fileName)

  const profile = await upscaleWorkflowStore.loadProfile()
  if (!profile) {
    throw appError(
      'upscale',
      'Capture a ComfyUI workflow first (Save workflow from the Upscale tab).'
    )
  }

  const ds = await getDatasetRecord(input.datasetId)
  const config = await getUpscaleImageConfig(input.datasetId, fileName)
  const settings = await loadSettings()
  const adapter = new ComfyAdapter(settings.comfy)

  cancelled = false
  running = true
  runningFileName = fileName

  void (async () => {
    try {
      await runOneUpscaleJob({
        datasetId: input.datasetId,
        fileName,
        folderPath: ds.folderPath,
        config,
        profile,
        adapter,
        settings,
        batchIndex: null,
        batchTotal: null
      })
    } catch (err) {
      handleUpscaleRunError(err, settings)
    } finally {
      running = false
      runningFileName = null
    }
  })()

  return { started: true }
}

/**
 * Upscale the starting image, then every other not-yet-upscaled image in the
 * dataset (scan order), reusing the same frozen prompt/settings. Already-upscaled
 * images other than the start file are skipped. Cancel stops after the current
 * Comfy job.
 */
export async function startUpscaleAll(input: {
  datasetId: string
  fileName: string
}): Promise<{ started: true; queued: number }> {
  if (running) {
    throw appError('busy', 'An upscale run is already in progress.')
  }
  const startFile = assertValidImageFileName(input.fileName)

  const profile = await upscaleWorkflowStore.loadProfile()
  if (!profile) {
    throw appError(
      'upscale',
      'Capture a ComfyUI workflow first (Save workflow from the Upscale tab).'
    )
  }

  const ds = await getDatasetRecord(input.datasetId)
  // Freeze panel settings for the whole batch (same prompt/model/denoise/…).
  const config = await getUpscaleImageConfig(input.datasetId, startFile)
  const settings = await loadSettings()
  const adapter = new ComfyAdapter(settings.comfy)

  const scanned = await scanFolder(ds.folderPath, ds.captionExt)
  const rest = scanned.images
    .filter((img) => img.fileName !== startFile && !img.hasOriginal)
    .map((img) => img.fileName)
  const queue = [startFile, ...rest]

  cancelled = false
  running = true
  runningFileName = startFile

  void (async () => {
    try {
      for (let i = 0; i < queue.length; i++) {
        if (cancelled) {
          setProgress({ status: 'cancelled', lastMessage: 'Cancelled' })
          return
        }
        const fileName = queue[i]!
        await runOneUpscaleJob({
          datasetId: input.datasetId,
          fileName,
          folderPath: ds.folderPath,
          config,
          profile,
          adapter,
          settings,
          batchIndex: i + 1,
          batchTotal: queue.length
        })
      }
      if (cancelled) {
        setProgress({ status: 'cancelled', lastMessage: 'Cancelled' })
      }
    } catch (err) {
      handleUpscaleRunError(err, settings)
    } finally {
      running = false
      runningFileName = null
    }
  })()

  return { started: true, queued: queue.length }
}

/**
 * Full revert: delete all VER_* / VER_COUNT — `$DATA` pristine remains (MFE revert).
 */
export async function revertUpscaleImage(input: {
  datasetId: string
  fileName: string
}): Promise<{ reverted: true }> {
  if (running && runningFileName === input.fileName && progress.datasetId === input.datasetId) {
    throw appError('busy', 'An upscale run is already in progress for this image.')
  }
  const fileName = assertValidImageFileName(input.fileName)
  await revertImageOriginal(input.datasetId, fileName)

  if (progress.datasetId === input.datasetId && progress.fileName === fileName) {
    setProgress({ status: 'idle', hasOriginal: false, lastMessage: 'Reverted to original' })
  }

  return { reverted: true }
}
