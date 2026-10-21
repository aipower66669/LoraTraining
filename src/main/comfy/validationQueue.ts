import { randomUUID } from 'node:crypto'
import {
  PREVIEW_COMPLETE_MARKER,
  type ValidationProgress,
  type ValidationRunConfig
} from '@shared/comfy'
import { formatComfyConnectError, isComfyUnreachableError } from '@shared/comfy'
import { resolveValidationModel } from '@shared/validation-model'
import { validationSetLabel } from '@shared/validation-sets'
import { appError } from '@shared/errors'
import { broadcast } from '../events/bus'
import { logger } from '../logging'
import { getDatasetRecord, syncDatasetValidatedFlag } from '../datasets/store'
import {
  locateComfyLora,
  recordStagedComfyLocation,
  resolveDefaultComfySubfolder
} from '../datasets/checkpointPrefs'
import { loadSettings, patchSettings } from '../settings/store'
import { ComfyAdapter, type ExecutionEvent } from './adapter'
import { formatComfyProgressLine, resolveWorkflowNodeTitle } from './comfyProgress'
import { injectValidationInputs, patchUiWorkflowSeed, readInjectedLtSeed } from './injectValidationInputs'
import { resolveNextValidationLora, resolveSetPreviewRelativePath, waitForSetPreview } from './nextValidationLora'
import { loadWorkflowProfile, type WorkflowGraph } from './workflowStore'
import { listValidationSets, validationSetOutputFolder } from './validationSets'
import {
  beginPreviewContinuum,
  onPreviewRunFinished,
  stopPreviewContinuum
} from './previewContinuum'
import { mkdir } from 'node:fs/promises'

let cancelled = false
let running = false
let progress: ValidationProgress = {
  status: 'idle',
  datasetId: null,
  setIndex: null,
  setLabel: null,
  jobsCompleted: 0
}

function emit(): void {
  broadcast({ type: 'validation-progress', payload: progress })
}

function setProgress(patch: Partial<ValidationProgress>): void {
  progress = { ...progress, ...patch }
  emit()
}

export function getValidationProgress(): ValidationProgress {
  return progress
}

/** Drop the live preview pointer when that set preview stem was deleted. */
export function clearValidationLastPreviewForStem(setLabel: string, stem: string): void {
  const cur = progress.lastPreviewRelativePath?.replace(/\\/g, '/')
  if (!cur || !stem.trim()) return
  const parts = cur.split('/')
  if (!parts.includes(setLabel)) return
  const base = parts[parts.length - 1] ?? ''
  const curStem = base.replace(/\.(jpe?g|png|webp)$/i, '')
  if (curStem.toLowerCase() !== stem.toLowerCase()) return
  setProgress({ lastPreviewRelativePath: null, lastPreviewFileName: null })
}

/** True while any validation loop is actively running (any dataset). */
export function isValidationRunning(): boolean {
  return running
}

export async function cancelValidation(): Promise<{ cancelled: true }> {
  cancelled = true
  stopPreviewContinuum()
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

/** True while a validation loop is actively processing this dataset. */
export function isValidationRunningForDataset(datasetId: string): boolean {
  return running && progress.datasetId === datasetId && progress.status === 'running'
}

/**
 * If validation is running for this dataset, cancel it and wait for the loop to exit.
 * Returns true when a cancel was issued.
 */
export async function cancelValidationIfActiveForDataset(
  datasetId: string
): Promise<boolean> {
  if (!isValidationRunningForDataset(datasetId)) return false
  await cancelValidation()
  const deadline = Date.now() + 20_000
  while (running && progress.datasetId === datasetId && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 40))
  }
  return true
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0
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

function isCompleteError(message: string): boolean {
  return message.includes(PREVIEW_COMPLETE_MARKER)
}


async function waitForPrompt(
  adapter: ComfyAdapter,
  clientId: string,
  promptId: string,
  workflow: WorkflowGraph,
  onComfyProgress: (patch: Partial<ValidationProgress>) => void
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
          // Prompt finished on the WS side; history poll will settle.
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

async function runOneJob(
  adapter: ComfyAdapter,
  datasetFolder: string,
  config: ValidationRunConfig,
  datasetTrigger: string,
  datasetSubfolder: string
): Promise<{ fileName: string; previewRelativePath: string | null }> {
  const profile = await loadWorkflowProfile()
  if (!profile) {
    throw appError('validation', 'Capture a ComfyUI workflow first (Save workflow from the Validate tab).')
  }

  await mkdir(validationSetOutputFolder(datasetFolder, config.setIndex), { recursive: true })
  const target = await resolveNextValidationLora(datasetFolder, config.setIndex, datasetTrigger)
  const settings = await loadSettings()
  const located = await locateComfyLora({
    datasetFolder,
    fileName: target.fileName,
    datasetSubfolder
  })
  let validationLoraSubfolder = resolveDefaultComfySubfolder({
    datasetSubfolder,
    globalSubfolder: settings.comfy.validationLoraSubfolder
  })
    if (located) {
      validationLoraSubfolder = located.relativeDir || validationLoraSubfolder
      await recordStagedComfyLocation({
        datasetFolder,
        fileName: target.fileName,
        relativeDir: validationLoraSubfolder
      })
    }
  const seedRaw = Number(config.seed)
  const seed =
    !Number.isFinite(seedRaw) || seedRaw <= 0
      ? randomSeed()
      : Math.floor(seedRaw)
  const model = resolveValidationModel(
    config.validationModel,
    settings.comfy.defaultValidationModel
  )
  const graph = injectValidationInputs(profile.workflow, datasetFolder, config, seed, target, {
    lorasFolder: settings.comfy.lorasFolder,
    validationLoraSubfolder,
    model
  })
  const verified = readInjectedLtSeed(graph)
  if (verified !== seed) {
    throw appError(
      'validation',
      `Failed to inject seed into LT · Seed (wanted ${seed}, graph has ${String(verified)}). Re-save the workflow after updating comfyui-lora-training.`
    )
  }
  const clientId = randomUUID()
  setProgress({
    status: 'running',
    lastMessage: `Validating ${target.fileName} (seed ${seed})…`,
    error: undefined,
    comfyNodeTitle: null,
    comfyStep: null,
    comfyMax: null,
    comfyDetail: null
  })

  const queued = await adapter.queuePrompt(graph, clientId, {
    uiWorkflow: patchUiWorkflowSeed(profile.uiWorkflow, seed)
  })
  await waitForPrompt(adapter, clientId, queued.promptId, graph, (patch) => setProgress(patch))
  await recordStagedComfyLocation({
    datasetFolder,
    fileName: target.fileName,
    relativeDir: validationLoraSubfolder
  })
  const appeared = await waitForSetPreview({
    datasetFolder,
    setIndex: config.setIndex,
    stem: target.stem
  })
  if (!appeared) {
    throw new Error(
      `ComfyUI finished but no preview appeared for ${target.stem} in ${validationSetLabel(config.setIndex)}.`
    )
  }
  const previewRelativePath = await resolveSetPreviewRelativePath({
    datasetFolder,
    setIndex: config.setIndex,
    stem: target.stem
  })
  return { fileName: target.fileName, previewRelativePath }
}

/**
 * Run missing validations for every set on this dataset, in order (Set 1 → Set N).
 * Each set uses its saved prompt/seed/weight/style from the dataset record.
 * The set list is re-read between sets so newly added sets during a run are included.
 *
 * When `chain` is false (user Run), enables the cross-dataset preview continuum so
 * unfinished Steps / Weight / Stress work on trained datasets continues after this one.
 */
export async function startValidation(input: {
  datasetId: string
  chain?: boolean
}): Promise<{ started: true }> {
  if (running) {
    throw appError('busy', 'A validation run is already in progress.')
  }
  const { isStressTestRunning } = await import('./stressQueue')
  if (isStressTestRunning()) {
    throw appError('busy', 'A model stress-test run is in progress — stop it before validating.')
  }
  const { isWeightValidationRunning } = await import('./weightQueue')
  if (isWeightValidationRunning()) {
    throw appError('busy', 'A validation-weight run is in progress — stop it before validating.')
  }
  await getDatasetRecord(input.datasetId)
  const sets = await listValidationSets(input.datasetId)
  if (sets.length === 0) {
    throw appError('validation', 'No validation sets defined for this dataset')
  }
  const settings = await loadSettings()
  const adapter = new ComfyAdapter(settings.comfy)

  if (!input.chain) {
    beginPreviewContinuum()
  }

  cancelled = false
  running = true
  setProgress({
    status: 'running',
    datasetId: input.datasetId,
    setIndex: 0,
    setLabel: validationSetLabel(0),
    jobsCompleted: 0,
    lastMessage: `Starting validation · ${sets.length} set${sets.length === 1 ? '' : 's'}…`,
    error: undefined,
    lastPreviewRelativePath: null,
    lastPreviewFileName: null,
    comfyNodeTitle: null,
    comfyStep: null,
    comfyMax: null,
    comfyDetail: null
  })

  void (async () => {
    let outcome: 'done' | 'cancelled' | 'error' = 'done'
    try {
      // Re-read set list every iteration so sets added mid-run are included.
      let setIndex = 0
      while (!cancelled) {
        const fresh = await listValidationSets(input.datasetId)
        if (setIndex >= fresh.length) break
        const set = fresh[setIndex]!

        const label = validationSetLabel(setIndex)
        const config: ValidationRunConfig = {
          datasetId: input.datasetId,
          setIndex,
          prompt: set.prompt,
          seed: set.seed,
          loraWeight: set.loraWeight,
          styleIndex: set.styleIndex === 1 ? 1 : 0,
          validationModel: set.validationModel?.trim() || 'Default',
          existingCopyPolicy: set.existingCopyPolicy
        }
        const rememberedPrompt = config.prompt.trim()
        if (rememberedPrompt) {
          await patchSettings({ lastValidationPrompt: rememberedPrompt })
        }

        setProgress({
          status: 'running',
          datasetId: input.datasetId,
          setIndex,
          setLabel: label,
          lastMessage: `Starting ${label} (${setIndex + 1}/${fresh.length})…`,
          error: undefined,
          comfyNodeTitle: null,
          comfyStep: null,
          comfyMax: null,
          comfyDetail: null
        })

        // Re-read dataset so trigger / meta edits mid-run are honored.
        // Set config (incl. model) already comes from fresh listValidationSets above.
        const dsNow = await getDatasetRecord(input.datasetId)

        let setDone = false
        while (!cancelled && !setDone) {
          try {
            // Re-read this set each job so model/prompt edits mid-run apply.
            const setsNow = await listValidationSets(input.datasetId)
            const setNow = setsNow[setIndex]
            const jobConfig: ValidationRunConfig = setNow
              ? {
                  ...config,
                  prompt: setNow.prompt,
                  seed: setNow.seed,
                  loraWeight: setNow.loraWeight,
                  styleIndex: setNow.styleIndex === 1 ? 1 : 0,
                  validationModel: setNow.validationModel?.trim() || 'Default',
                  existingCopyPolicy: setNow.existingCopyPolicy
                }
              : config
            const done = await runOneJob(
              adapter,
              dsNow.folderPath,
              jobConfig,
              dsNow.trigger ?? '',
              ''
            )
            if (cancelled) break
            const completed = progress.jobsCompleted + 1
            setProgress({
              jobsCompleted: completed,
              lastMessage: `${label} · completed #${completed} · ${done.fileName}`,
              lastPreviewRelativePath: done.previewRelativePath,
              lastPreviewFileName: done.fileName,
              comfyNodeTitle: null,
              comfyStep: null,
              comfyMax: null,
              comfyDetail: null
            })
          } catch (err) {
            let message = errorMessage(err)
            if (message === 'cancelled' || cancelled) {
              outcome = 'cancelled'
              setProgress({ status: 'cancelled', lastMessage: 'Cancelled' })
              await syncDatasetValidatedFlag(input.datasetId).catch(() => undefined)
              return
            }
            if (isCompleteError(message)) {
              setProgress({
                lastMessage: `${label}: all checkpoints have validation images.`,
                error: undefined
              })
              setDone = true
              break
            }
            if (isComfyUnreachableError(err) || message === 'fetch failed') {
              message = formatComfyConnectError(settings.comfy, err)
            }
            outcome = 'error'
            setProgress({ status: 'error', error: message, lastMessage: message })
            await syncDatasetValidatedFlag(input.datasetId).catch(() => undefined)
            return
          }
        }

        setIndex += 1
      }

      if (cancelled) {
        outcome = 'cancelled'
        setProgress({ status: 'cancelled', lastMessage: 'Cancelled' })
        await syncDatasetValidatedFlag(input.datasetId).catch(() => undefined)
      } else {
        const complete = await syncDatasetValidatedFlag(input.datasetId).catch(() => false)
        setProgress({
          status: 'done',
          lastMessage: complete
            ? 'All validation sets complete.'
            : 'Validation finished — some sets still need previews.',
          error: undefined
        })
      }
    } catch (err) {
      // Unexpected throw outside the per-job catch — still hand off to continuum.
      if (outcome === 'done') {
        outcome = cancelled ? 'cancelled' : 'error'
        const message = errorMessage(err)
        if (!cancelled) {
          setProgress({ status: 'error', error: message, lastMessage: message })
        }
      }
      await syncDatasetValidatedFlag(input.datasetId).catch(() => undefined)
    } finally {
      running = false
      await onPreviewRunFinished(
        { datasetId: input.datasetId, kind: 'validation' },
        outcome
      ).catch((err) => {
        logger.warn({ err }, 'preview continuum: onPreviewRunFinished failed')
      })
    }
  })()

  return { started: true }
}
