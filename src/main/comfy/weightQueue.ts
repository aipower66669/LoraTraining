import { randomUUID } from 'node:crypto'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import {
  type ValidationRunConfig,
  type WeightValidationProgress
} from '@shared/comfy'
import { formatComfyConnectError, isComfyUnreachableError } from '@shared/comfy'
import { resolveValidationModel } from '@shared/validation-model'
import {
  enumerateWeightSteps,
  formatWeightPreviewStem,
  weightSetLabel,
  weightsMissingPreviews
} from '@shared/weight-sets'
import { appError } from '@shared/errors'
import { isPreviewOutputDirName } from '@shared/validation-sets'
import { broadcast } from '../events/bus'
import { logger } from '../logging'
import { getDatasetRecord } from '../datasets/store'
import {
  locateComfyLora,
  recordStagedComfyLocation,
  resolveDefaultComfySubfolder
} from '../datasets/checkpointPrefs'
import { loadSettings, patchSettings } from '../settings/store'
import { ComfyAdapter, type ExecutionEvent } from './adapter'
import { formatComfyProgressLine, resolveWorkflowNodeTitle } from './comfyProgress'
import { injectValidationInputs, patchUiWorkflowSeed, readInjectedLtSeed } from './injectValidationInputs'
import {
  type NextValidationLora,
  resolveOutputPreviewRelativePath,
  waitForOutputPreview
} from './nextValidationLora'
import { loadWorkflowProfile, type WorkflowGraph } from './workflowStore'
import { listWeightSets, weightSetOutputFolder } from './weightSets'
import {
  beginPreviewContinuum,
  onPreviewRunFinished,
  stopPreviewContinuum
} from './previewContinuum'

let cancelled = false
let running = false
let progress: WeightValidationProgress = {
  status: 'idle',
  datasetId: null,
  setIndex: null,
  setLabel: null,
  jobsCompleted: 0,
  currentWeight: null,
  jobsTotal: null
}

function emit(): void {
  broadcast({ type: 'weight-progress', payload: progress })
}

function setProgress(patch: Partial<WeightValidationProgress>): void {
  progress = { ...progress, ...patch }
  emit()
}

export function getWeightValidationProgress(): WeightValidationProgress {
  return progress
}

export function clearWeightLastPreviewForStem(setLabel: string, stem: string): void {
  const cur = progress.lastPreviewRelativePath?.replace(/\\/g, '/')
  if (!cur || !stem.trim()) return
  const parts = cur.split('/')
  if (!parts.includes(setLabel)) return
  const base = parts[parts.length - 1] ?? ''
  const curStem = base.replace(/\.(jpe?g|png|webp)$/i, '')
  if (curStem.toLowerCase() !== stem.toLowerCase()) return
  setProgress({ lastPreviewRelativePath: null, lastPreviewFileName: null })
}

export function isWeightValidationRunning(): boolean {
  return running
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

export async function cancelWeightValidation(): Promise<{ cancelled: true }> {
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

export function isWeightValidationRunningForDataset(datasetId: string): boolean {
  return running && progress.datasetId === datasetId && progress.status === 'running'
}

export async function cancelWeightValidationIfActiveForDataset(
  datasetId: string
): Promise<boolean> {
  if (!isWeightValidationRunningForDataset(datasetId)) return false
  await cancelWeightValidation()
  const deadline = Date.now() + 20_000
  while (running && progress.datasetId === datasetId && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 40))
  }
  return true
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0
}

async function hasPreviewImage(previewStemPath: string): Promise<boolean> {
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
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

async function resolveChosenCheckpoint(
  datasetFolder: string,
  fileName: string,
  datasetTrigger: string
): Promise<NextValidationLora> {
  const base = basename(fileName)
  if (
    !base ||
    base !== fileName ||
    fileName.includes('..') ||
    fileName.includes('/') ||
    fileName.includes('\\')
  ) {
    throw appError('validation', `Invalid checkpoint file name: ${fileName}`)
  }
  const outputRootPath = join(datasetFolder, 'output')
  const stack = [outputRootPath]
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      if (isPreviewOutputDirName(name)) continue
      const full = join(dir, name)
      let st
      try {
        st = await stat(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!st.isFile() || name.toLowerCase() !== base.toLowerCase()) continue
      if (extname(name).toLowerCase() !== '.safetensors') continue
      const stem = basename(name, extname(name))
      const parentName = basename(dir).trim()
      const folderTrigger =
        parentName && parentName.toLowerCase() !== 'output' && !isPreviewOutputDirName(parentName)
          ? parentName
          : ''
      const relativePath = full
        .slice(outputRootPath.length)
        .replace(/^[/\\]/, '')
        .replace(/\\/g, '/')
      return {
        fileName: name,
        relativePath,
        fullPath: full,
        stem,
        triggerKeyword: datasetTrigger.trim() || folderTrigger || stem
      }
    }
  }
  throw appError('not-found', `Checkpoint not found under output/: ${base}`)
}

async function waitForPrompt(
  adapter: ComfyAdapter,
  clientId: string,
  promptId: string,
  workflow: WorkflowGraph,
  onComfyProgress: (patch: Partial<WeightValidationProgress>) => void
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

async function runOneWeightJob(opts: {
  adapter: ComfyAdapter
  datasetFolder: string
  config: ValidationRunConfig
  target: NextValidationLora
  weight: number
  setLabel: string
  previewStem: string
  datasetSubfolder: string
}): Promise<{ previewRelativePath: string | null }> {
  const { adapter, datasetFolder, config, target, weight, setLabel, previewStem, datasetSubfolder } =
    opts
  const profile = await loadWorkflowProfile()
  if (!profile) {
    throw appError(
      'validation',
      'Capture a ComfyUI workflow first (Save workflow from the Validation Steps tab).'
    )
  }

  await mkdir(join(datasetFolder, 'output', setLabel), { recursive: true })
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
    !Number.isFinite(seedRaw) || seedRaw <= 0 ? randomSeed() : Math.floor(seedRaw)
  const model = resolveValidationModel(
    config.validationModel,
    settings.comfy.defaultValidationModel
  )
  const graph = injectValidationInputs(profile.workflow, datasetFolder, config, seed, target, {
    lorasFolder: settings.comfy.lorasFolder,
    validationLoraSubfolder,
    model,
    outputFolder: join(datasetFolder, 'output', setLabel),
    outputFilename: previewStem
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
    currentWeight: weight,
    lastMessage: `Weight ${target.fileName} @ ${previewStem} (seed ${seed})…`,
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
  const appeared = await waitForOutputPreview({
    datasetFolder,
    setLabel,
    stem: previewStem
  })
  if (!appeared) {
    throw new Error(
      `ComfyUI finished but no preview appeared for weight ${previewStem} in ${setLabel}.`
    )
  }
  const previewRelativePath = await resolveOutputPreviewRelativePath({
    datasetFolder,
    setLabel,
    stem: previewStem
  })
  return { previewRelativePath }
}

/**
 * Run missing weight previews for every Weight set on this dataset.
 * Fixed LoRA + model per set; varies LoRA strength each job.
 *
 * When `chain` is false (user Run), enables the cross-dataset preview continuum so
 * unfinished Steps / Weight / Stress work on trained datasets continues after this one.
 */
export async function startWeightValidation(input: {
  datasetId: string
  chain?: boolean
}): Promise<{ started: true }> {
  if (running) {
    throw appError('busy', 'A validation-weight run is already in progress.')
  }
  const { isValidationRunning } = await import('./validationQueue')
  if (isValidationRunning()) {
    throw appError('busy', 'A LoRA validation run is in progress — stop it before weight validation.')
  }
  const { isStressTestRunning } = await import('./stressQueue')
  if (isStressTestRunning()) {
    throw appError('busy', 'A model stress-test run is in progress — stop it before weight validation.')
  }

  const sets = await listWeightSets(input.datasetId)
  if (sets.length === 0) {
    throw appError('validation', 'No weight-validation sets defined for this dataset')
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
    setLabel: weightSetLabel(0),
    jobsCompleted: 0,
    jobsTotal: null,
    currentWeight: null,
    lastMessage: `Starting weight validation · ${sets.length} set${sets.length === 1 ? '' : 's'}…`,
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
      let setIndex = 0
      while (!cancelled) {
        const fresh = await listWeightSets(input.datasetId)
        if (setIndex >= fresh.length) break
        const set = fresh[setIndex]!
        const label = weightSetLabel(setIndex)

        if (!set.checkpointFileName?.trim()) {
          setProgress({
            lastMessage: `${label}: skipped — pick a LoRA checkpoint.`,
            error: undefined
          })
          setIndex += 1
          continue
        }

        const enumerated = enumerateWeightSteps(set.weightMin, set.weightMax, set.weightStep)
        if (!enumerated.ok) {
          outcome = 'error'
          const message = `${label}: ${enumerated.error}`
          setProgress({ status: 'error', error: message, lastMessage: message })
          return
        }

        const rememberedPrompt = set.prompt.trim()
        if (rememberedPrompt) {
          await patchSettings({ lastValidationPrompt: rememberedPrompt })
        }

        setProgress({
          status: 'running',
          datasetId: input.datasetId,
          setIndex,
          setLabel: label,
          currentWeight: null,
          lastMessage: `Starting ${label} (${setIndex + 1}/${fresh.length})…`,
          error: undefined,
          comfyNodeTitle: null,
          comfyStep: null,
          comfyMax: null,
          comfyDetail: null
        })

        const dsNow = await getDatasetRecord(input.datasetId)
        let target: NextValidationLora
        try {
          target = await resolveChosenCheckpoint(
            dsNow.folderPath,
            set.checkpointFileName.trim(),
            dsNow.trigger ?? ''
          )
        } catch (err) {
          const message = `${label}: ${errorMessage(err)}`
          outcome = 'error'
          setProgress({ status: 'error', error: message, lastMessage: message })
          return
        }

        await mkdir(weightSetOutputFolder(dsNow.folderPath, setIndex), { recursive: true })

        const checkpointName = set.checkpointFileName.trim()
        const existingLower = new Set<string>()
        for (const w of enumerated.weights) {
          const stem = formatWeightPreviewStem(checkpointName, w)
          const previewStemPath = join(dsNow.folderPath, 'output', label, stem)
          if (await hasPreviewImage(previewStemPath)) {
            existingLower.add(stem.toLowerCase())
          }
        }
        const pending = weightsMissingPreviews(
          checkpointName,
          enumerated.weights,
          existingLower
        )
        setProgress({ jobsTotal: pending.length })

        if (pending.length === 0) {
          setProgress({
            lastMessage: `${label}: all weights already have previews.`,
            error: undefined
          })
          setIndex += 1
          continue
        }

        for (const weight of pending) {
          if (cancelled) break
          const setsNow = await listWeightSets(input.datasetId)
          const setNow = setsNow[setIndex] ?? set
          const enumNow = enumerateWeightSteps(
            setNow.weightMin,
            setNow.weightMax,
            setNow.weightStep
          )
          if (!enumNow.ok) continue
          const checkpointNow =
            setNow.checkpointFileName?.trim() || checkpointName
          if (
            !enumNow.weights.some(
              (w) =>
                formatWeightPreviewStem(checkpointNow, w) ===
                formatWeightPreviewStem(checkpointNow, weight)
            )
          ) {
            continue
          }

          const previewStem = formatWeightPreviewStem(checkpointNow, weight)
          const config: ValidationRunConfig = {
            datasetId: input.datasetId,
            setIndex,
            prompt: setNow.prompt,
            seed: setNow.seed,
            loraWeight: weight,
            styleIndex: setNow.styleIndex === 1 ? 1 : 0,
            validationModel: setNow.validationModel?.trim() || 'Default',
            existingCopyPolicy: setNow.existingCopyPolicy
          }

          try {
            const done = await runOneWeightJob({
              adapter,
              datasetFolder: dsNow.folderPath,
              config,
              target,
              weight,
              setLabel: label,
              previewStem,
              datasetSubfolder: ''
            })
            if (cancelled) break
            const completed = progress.jobsCompleted + 1
            setProgress({
              jobsCompleted: completed,
              currentWeight: weight,
              lastMessage: `${label} · completed #${completed} · weight ${previewStem}`,
              lastPreviewRelativePath: done.previewRelativePath,
              lastPreviewFileName: previewStem,
              comfyNodeTitle: null,
              comfyStep: null,
              comfyMax: null,
              comfyDetail: null
            })
            broadcast({
              type: 'weight-previews-changed',
              payload: { datasetId: input.datasetId, setIndex }
            })
          } catch (err) {
            let message = errorMessage(err)
            if (message === 'cancelled' || cancelled) {
              outcome = 'cancelled'
              setProgress({ status: 'cancelled', lastMessage: 'Cancelled' })
              return
            }
            if (isComfyUnreachableError(err) || message === 'fetch failed') {
              message = formatComfyConnectError(settings.comfy, err)
            }
            const withWeight = `${label} · weight ${previewStem}: ${message}`
            outcome = 'error'
            setProgress({
              status: 'error',
              error: withWeight,
              lastMessage: withWeight,
              currentWeight: weight
            })
            return
          }
        }

        setIndex += 1
      }

      if (cancelled) {
        outcome = 'cancelled'
        setProgress({ status: 'cancelled', lastMessage: 'Cancelled' })
      } else {
        setProgress({
          status: 'done',
          lastMessage: 'All weight-validation sets complete.',
          error: undefined,
          currentWeight: null
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
    } finally {
      running = false
      await onPreviewRunFinished(
        { datasetId: input.datasetId, kind: 'weight' },
        outcome
      ).catch((err) => {
        logger.warn({ err }, 'preview continuum: onPreviewRunFinished failed')
      })
    }
  })()

  return { started: true }
}
