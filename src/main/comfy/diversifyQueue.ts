import { randomUUID } from 'node:crypto'
import { access, copyFile, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { DiversifyProgress, DiversifyRunConfig } from '@shared/comfy'
import { DEFAULT_DIVERSIFY_PROGRESS } from '@shared/comfy'
import { formatComfyConnectError, isComfyUnreachableError } from '@shared/comfy'
import type { DiversifyConfig, DiversifyMode } from '@shared/diversify-config'
import {
  isDiversifySiblingStem,
  nextDiversifyFileName
} from '@shared/diversify-filename'
import { imageStem, IMAGE_EXTENSIONS } from '@shared/schemas/dataset'
import { libraryDiversifyTmpDir } from '@shared/library-paths'
import { appError } from '@shared/errors'
import type { AppSettings } from '@shared/schemas/settings'
import { broadcast } from '../events/bus'
import { getDatasetRecord, scanFolder } from '../datasets/store'
import { getLibraryRoot, loadSettings } from '../settings/store'
import { assertInsideRoot } from '../security/path-guards'
import { reencodeToExtension } from '../media/reencode'
import { ComfyAdapter, type ExecutionEvent } from './adapter'
import { formatComfyProgressLine, resolveWorkflowNodeTitle } from './comfyProgress'
import { injectDiversifyInputs } from './injectDiversifyInputs'
import { readInjectedLtSeed } from './injectValidationInputs'
import { getDiversifyConfig } from './diversifyConfig'
import {
  contextWorkflowStore,
  expressionWorkflowStore,
  type WorkflowGraph,
  type WorkflowProfile
} from './workflowStore'

let cancelled = false
let running = false
let _runningFileName: string | null = null
let progress: DiversifyProgress = { ...DEFAULT_DIVERSIFY_PROGRESS }

const RESULT_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp']

function emit(): void {
  broadcast({ type: 'diversify-progress', payload: progress })
}

function setProgress(patch: Partial<DiversifyProgress>): void {
  progress = { ...progress, ...patch }
  emit()
}

export function getDiversifyProgress(): DiversifyProgress {
  return progress
}

export async function cancelDiversify(): Promise<{ cancelled: true }> {
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

function workflowStoreFor(mode: DiversifyMode): typeof contextWorkflowStore {
  return mode === 'context' ? contextWorkflowStore : expressionWorkflowStore
}

async function waitForPrompt(
  adapter: ComfyAdapter,
  clientId: string,
  promptId: string,
  workflow: WorkflowGraph,
  onComfyProgress: (patch: Partial<DiversifyProgress>) => void
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
        if (event.nodeId == null) return
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
              finish(new Error(JSON.stringify(status.messages ?? status)))
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

async function findResultFile(folder: string, baseStem: string): Promise<string | null> {
  let entries: string[] = []
  try {
    entries = await readdir(folder)
  } catch {
    return null
  }
  const targetLower = baseStem.toLowerCase()
  for (const ext of RESULT_EXTENSIONS) {
    const exact = entries.find((f) => f.toLowerCase() === `${targetLower}${ext}`)
    if (exact) return join(folder, exact)
  }
  const prefixed = entries
    .filter((f) => {
      const lower = f.toLowerCase()
      return lower.startsWith(targetLower) && RESULT_EXTENSIONS.some((ext) => lower.endsWith(ext))
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

/** Expression keeps the same scene/clothing — copy parent caption. Context does not. */
async function copyParentCaptionIfNeeded(
  mode: DiversifyMode,
  folderPath: string,
  sourceFileName: string,
  outputFileName: string,
  captionExt: string
): Promise<void> {
  if (mode !== 'expression') return
  const parentStem = imageStem(sourceFileName)
  const childStem = imageStem(outputFileName)
  const src = assertInsideRoot(folderPath, join(folderPath, `${parentStem}.${captionExt}`))
  const dest = assertInsideRoot(folderPath, join(folderPath, `${childStem}.${captionExt}`))
  try {
    await access(src, constants.F_OK)
  } catch {
    return
  }
  await copyFile(src, dest)
}

async function runOneDiversifyJob(opts: {
  datasetId: string
  mode: DiversifyMode
  fileName: string
  folderPath: string
  captionExt: string
  config: DiversifyConfig
  seed: number
  outputFileName: string
  profile: WorkflowProfile
  adapter: ComfyAdapter
  batchIndex: number | null
  batchTotal: number | null
}): Promise<void> {
  const {
    datasetId,
    mode,
    fileName,
    folderPath,
    captionExt,
    config,
    seed,
    outputFileName,
    profile,
    adapter
  } = opts

  const currentPath = assertInsideRoot(folderPath, join(folderPath, fileName))
  try {
    await access(currentPath, constants.F_OK)
  } catch {
    throw appError('not-found', `Image not found: ${fileName}`)
  }

  const { resolveTipOpenPath, cleanupTipStage } = await import('../images/imageEdit')
  const tip = await resolveTipOpenPath(currentPath)
  const sourceImagePath = tip.openPath

  try {
    const tmpDir = libraryDiversifyTmpDir(getLibraryRoot())
    const runConfig: DiversifyRunConfig = {
      datasetId,
      mode,
      fileName,
      sourceImagePath,
      prompt: config.prompt,
      seed,
      outputFileName
    }

    _runningFileName = fileName
    const batchLabel =
      opts.batchTotal != null && opts.batchIndex != null
        ? ` (${opts.batchIndex}/${opts.batchTotal})`
        : ''
    setProgress({
      status: 'running',
      datasetId,
      mode,
      fileName,
      outputFileName: null,
      batchIndex: opts.batchIndex,
      batchTotal: opts.batchTotal,
      lastMessage: `Starting diversify${batchLabel} → ${outputFileName} (seed ${seed})…`,
      error: undefined,
      comfyNodeTitle: null,
      comfyStep: null,
      comfyMax: null,
      comfyDetail: null
    })

    await mkdir(tmpDir, { recursive: true })
    const graph = injectDiversifyInputs(profile.workflow, runConfig, seed, tmpDir)
    const verified = readInjectedLtSeed(graph)
    if (verified !== seed) {
      throw appError(
        'diversify',
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
    if (cancelled) throw new Error('cancelled')

    const outStem = imageStem(outputFileName)
    const rawResultPath = await waitForResultFile(tmpDir, outStem)
    if (!rawResultPath) {
      throw new Error(
        `ComfyUI finished but no “${outStem}” result appeared in ${tmpDir}.`
      )
    }

    const destPath = assertInsideRoot(folderPath, join(folderPath, outputFileName))
    const rawBuffer = await readFile(rawResultPath)
    const converted = await reencodeToExtension(rawBuffer, outputFileName)
    await writeFile(destPath, converted)
    await unlink(rawResultPath).catch(() => undefined)

    await copyParentCaptionIfNeeded(mode, folderPath, fileName, outputFileName, captionExt)

    const { invalidateDatasetThumb } = await import('../media/thumbs')
    await invalidateDatasetThumb(datasetId, outputFileName, folderPath)

    const isBatchLast =
      opts.batchTotal == null ||
      opts.batchIndex == null ||
      opts.batchIndex >= opts.batchTotal

    setProgress({
      status: isBatchLast ? 'done' : 'running',
      outputFileName,
      lastMessage:
        opts.batchTotal != null && opts.batchIndex != null
          ? `Done · ${outputFileName} (${opts.batchIndex}/${opts.batchTotal})`
          : `Done · ${outputFileName}`,
      error: undefined,
      comfyNodeTitle: null,
      comfyStep: null,
      comfyMax: null,
      comfyDetail: null
    })

    broadcast({ type: 'dataset-folder-changed', payload: { datasetId } })
  } finally {
    await cleanupTipStage(tip.stagedPath)
  }
}

function handleRunError(err: unknown, settings: AppSettings): void {
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

function allocateOutputName(
  sourceFileName: string,
  knownNames: Set<string>
): string {
  const next = nextDiversifyFileName(sourceFileName, knownNames)
  knownNames.add(next)
  return next
}

async function runJobsForSources(opts: {
  datasetId: string
  mode: DiversifyMode
  sources: string[]
  folderPath: string
  captionExt: string
  config: DiversifyConfig
  profile: WorkflowProfile
  adapter: ComfyAdapter
  settings: AppSettings
}): Promise<void> {
  const count = Math.max(1, Math.floor(opts.config.count))
  // Expression: always random per job (no seed field). Context: ≤0 = random base, else fixed + offset.
  const seedRaw = opts.mode === 'expression' ? 0 : Number(opts.config.seed)
  const baseSeed =
    !Number.isFinite(seedRaw) || seedRaw <= 0 ? randomSeed() : Math.floor(seedRaw)

  const scanned = await scanFolder(opts.folderPath, opts.captionExt)
  const knownNames = new Set(scanned.images.map((i) => i.fileName))
  // Also include non-image siblings that nextDiversify shouldn't collide with.
  try {
    for (const name of await readdir(opts.folderPath)) {
      knownNames.add(name)
    }
  } catch {
    /* ignore */
  }

  const totalJobs = opts.sources.length * count
  let jobIndex = 0

  for (const sourceFile of opts.sources) {
    for (let k = 0; k < count; k++) {
      if (cancelled) {
        setProgress({ status: 'cancelled', lastMessage: 'Cancelled' })
        return
      }
      jobIndex += 1
      const outputFileName = allocateOutputName(sourceFile, knownNames)
      const seed =
        opts.mode === 'expression'
          ? randomSeed()
          : (baseSeed + (jobIndex - 1)) >>> 0
      await runOneDiversifyJob({
        datasetId: opts.datasetId,
        mode: opts.mode,
        fileName: sourceFile,
        folderPath: opts.folderPath,
        captionExt: opts.captionExt,
        config: opts.config,
        seed,
        outputFileName,
        profile: opts.profile,
        adapter: opts.adapter,
        batchIndex: totalJobs > 1 ? jobIndex : null,
        batchTotal: totalJobs > 1 ? totalJobs : null
      })
    }
  }
}

export async function startDiversify(input: {
  datasetId: string
  fileName: string
  mode: DiversifyMode
}): Promise<{ started: true }> {
  if (running) {
    throw appError('busy', 'A diversify run is already in progress.')
  }
  const fileName = assertValidImageFileName(input.fileName)
  const mode = input.mode

  const profile = await workflowStoreFor(mode).loadProfile()
  if (!profile || Object.keys(profile.workflow).length === 0) {
    throw appError(
      'diversify',
      `Capture a ComfyUI workflow first (Save workflow from the ${mode === 'context' ? 'Context' : 'Expression'} tab).`
    )
  }

  const ds = await getDatasetRecord(input.datasetId)
  const config = await getDiversifyConfig(mode, input.datasetId, fileName)
  const settings = await loadSettings()
  const adapter = new ComfyAdapter(settings.comfy)

  cancelled = false
  running = true
  _runningFileName = fileName

  void (async () => {
    try {
      await runJobsForSources({
        datasetId: input.datasetId,
        mode,
        sources: [fileName],
        folderPath: ds.folderPath,
        captionExt: ds.captionExt,
        config,
        profile,
        adapter,
        settings
      })
    } catch (err) {
      handleRunError(err, settings)
    } finally {
      running = false
      _runningFileName = null
    }
  })()

  return { started: true }
}

/**
 * Diversify root images only. Snapshot the root list once before starting so
 * mid-run siblings are never queued. Start file is first when it is a root.
 */
export async function startDiversifyAll(input: {
  datasetId: string
  fileName: string
  mode: DiversifyMode
}): Promise<{ started: true; queued: number }> {
  if (running) {
    throw appError('busy', 'A diversify run is already in progress.')
  }
  const startFile = assertValidImageFileName(input.fileName)
  const mode = input.mode

  const profile = await workflowStoreFor(mode).loadProfile()
  if (!profile || Object.keys(profile.workflow).length === 0) {
    throw appError(
      'diversify',
      `Capture a ComfyUI workflow first (Save workflow from the ${mode === 'context' ? 'Context' : 'Expression'} tab).`
    )
  }

  const ds = await getDatasetRecord(input.datasetId)
  const config = await getDiversifyConfig(mode, input.datasetId, startFile)
  const settings = await loadSettings()
  const adapter = new ComfyAdapter(settings.comfy)

  const scanned = await scanFolder(ds.folderPath, ds.captionExt)
  const roots = scanned.images
    .filter((img) => !isDiversifySiblingStem(imageStem(img.fileName)))
    .map((img) => img.fileName)
  const startIsRoot = roots.includes(startFile)
  const sources = startIsRoot
    ? [startFile, ...roots.filter((f) => f !== startFile)]
    : roots

  if (sources.length === 0) {
    throw appError('validation', 'No root images to diversify (only Diversify siblings found).')
  }

  const queued = sources.length * Math.max(1, Math.floor(config.count))

  cancelled = false
  running = true
  _runningFileName = sources[0]!

  void (async () => {
    try {
      await runJobsForSources({
        datasetId: input.datasetId,
        mode,
        sources,
        folderPath: ds.folderPath,
        captionExt: ds.captionExt,
        config,
        profile,
        adapter,
        settings
      })
      if (cancelled) {
        setProgress({ status: 'cancelled', lastMessage: 'Cancelled' })
      }
    } catch (err) {
      handleRunError(err, settings)
    } finally {
      running = false
      _runningFileName = null
    }
  })()

  return { started: true, queued }
}
