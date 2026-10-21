import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import {
  type StressTestProgress,
  type ValidationRunConfig
} from '@shared/comfy'
import { formatComfyConnectError, isComfyUnreachableError, shortenComfyError } from '@shared/comfy'
import { resolveValidationModel } from '@shared/validation-model'
import {
  isMissingComfyModelError,
  modelPreviewStemMap,
  modelsMissingPreviews,
  previewStemsForModel,
  pruneModelsToAvailable,
  stressTestSetLabel
} from '@shared/stress-sets'
import { appError } from '@shared/errors'
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
import { listStressTestSets, stressTestSetOutputFolder, updateStressTestSet } from './stressSets'
import { listComfyCheckpointModels } from './modelList'
import {
  beginPreviewContinuum,
  onPreviewRunFinished,
  stopPreviewContinuum
} from './previewContinuum'
import { readdir, stat } from 'node:fs/promises'
import { isPreviewOutputDirName } from '@shared/validation-sets'

let cancelled = false
let running = false
let progress: StressTestProgress = {
  status: 'idle',
  datasetId: null,
  setIndex: null,
  setLabel: null,
  jobsCompleted: 0,
  currentModel: null,
  jobsTotal: null
}

function emit(): void {
  broadcast({ type: 'stress-progress', payload: progress })
}

function setProgress(patch: Partial<StressTestProgress>): void {
  progress = { ...progress, ...patch }
  emit()
}

export function getStressTestProgress(): StressTestProgress {
  return progress
}

/** Drop the live preview pointer when that set preview stem was deleted. */
export function clearStressLastPreviewForStem(setLabel: string, stem: string): void {
  const cur = progress.lastPreviewRelativePath?.replace(/\\/g, '/')
  if (!cur || !stem.trim()) return
  const parts = cur.split('/')
  if (!parts.includes(setLabel)) return
  const base = parts[parts.length - 1] ?? ''
  const curStem = base.replace(/\.(jpe?g|png|webp)$/i, '')
  if (curStem.toLowerCase() !== stem.toLowerCase()) return
  setProgress({ lastPreviewRelativePath: null, lastPreviewFileName: null })
}

export function isStressTestRunning(): boolean {
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

export async function cancelStressTest(): Promise<{ cancelled: true }> {
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

export function isStressTestRunningForDataset(datasetId: string): boolean {
  return running && progress.datasetId === datasetId && progress.status === 'running'
}

export async function cancelStressTestIfActiveForDataset(datasetId: string): Promise<boolean> {
  if (!isStressTestRunningForDataset(datasetId)) return false
  await cancelStressTest()
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
  if (!base || base !== fileName || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    throw appError('validation', `Invalid checkpoint file name: ${fileName}`)
  }
  const outputRoot = join(datasetFolder, 'output')
  const stack = [outputRoot]
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
      const relativePath = full.slice(outputRoot.length).replace(/^[/\\]/, '').replace(/\\/g, '/')
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
  onComfyProgress: (patch: Partial<StressTestProgress>) => void
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
        finish(new Error(shortenComfyError(event.message || 'ComfyUI execution error')))
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
              finish(new Error(shortenComfyError(msg)))
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

async function runOneModelJob(opts: {
  adapter: ComfyAdapter
  datasetFolder: string
  config: ValidationRunConfig
  target: NextValidationLora
  modelName: string
  setLabel: string
  previewStem: string
  datasetSubfolder: string
}): Promise<{ previewRelativePath: string | null }> {
  const { adapter, datasetFolder, config, target, modelName, setLabel, previewStem, datasetSubfolder } =
    opts
  const profile = await loadWorkflowProfile()
  if (!profile) {
    throw appError(
      'validation',
      'Capture a ComfyUI workflow first (Save workflow from the LoRA Validation tab).'
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
  const model = resolveValidationModel(modelName, settings.comfy.defaultValidationModel)
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
    currentModel: modelName,
    lastMessage: `Stress ${target.fileName} × ${modelName} (seed ${seed})…`,
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
      `ComfyUI finished but no preview appeared for model “${modelName}” in ${setLabel}.`
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
 * Run missing model previews for every stress set on this dataset.
 * Fixed LoRA per set; varies Comfy model each iteration. Uses the Validation workflow.
 *
 * When `chain` is false (user Run), enables the cross-dataset preview continuum so
 * unfinished Steps / Weight / Stress work on trained datasets continues after this one.
 * Sets without a checkpoint or models are skipped (not an error).
 */
export async function startStressTest(input: {
  datasetId: string
  chain?: boolean
}): Promise<{ started: true }> {
  if (running) {
    throw appError('busy', 'A model stress-test run is already in progress.')
  }
  const { isValidationRunning } = await import('./validationQueue')
  if (isValidationRunning()) {
    throw appError('busy', 'A LoRA validation run is in progress — stop it before stress-testing.')
  }
  const { isWeightValidationRunning } = await import('./weightQueue')
  if (isWeightValidationRunning()) {
    throw appError(
      'busy',
      'A validation-weight run is in progress — stop it before stress-testing.'
    )
  }

  const sets = await listStressTestSets(input.datasetId)
  if (sets.length === 0) {
    throw appError('validation', 'No stress-test sets defined for this dataset')
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
    setLabel: stressTestSetLabel(0),
    jobsCompleted: 0,
    jobsTotal: null,
    currentModel: null,
    lastMessage: `Starting stress-test · ${sets.length} set${sets.length === 1 ? '' : 's'}…`,
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
    /** Per-model failures — do not abort the rest of the stress run. */
    const failedModels: Array<{ setLabel: string; modelName: string; error: string }> = []
    try {
      let setIndex = 0
      while (!cancelled) {
        const fresh = await listStressTestSets(input.datasetId)
        if (setIndex >= fresh.length) break
        const set = fresh[setIndex]!
        const label = stressTestSetLabel(setIndex)

        if (!set.checkpointFileName?.trim()) {
          setProgress({
            lastMessage: `${label}: skipped — pick a LoRA checkpoint.`,
            error: undefined
          })
          setIndex += 1
          continue
        }
        if (set.models.length === 0) {
          setProgress({
            lastMessage: `${label}: skipped — no models selected.`,
            error: undefined
          })
          setIndex += 1
          continue
        }

        const rememberedPrompt = set.prompt.trim()
        if (rememberedPrompt) {
          await patchSettings({ lastValidationPrompt: rememberedPrompt })
        }
        if (set.models.length > 0) {
          await patchSettings({ lastStressModels: [...set.models] })
        }

        setProgress({
          status: 'running',
          datasetId: input.datasetId,
          setIndex,
          setLabel: label,
          currentModel: null,
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

        await mkdir(stressTestSetOutputFolder(dsNow.folderPath, setIndex), { recursive: true })

        // Drop weights that Comfy no longer lists (deleted/renamed) — do not fail the run.
        let models = [...set.models]
        try {
          const { models: available } = await listComfyCheckpointModels(true)
          const { kept, removed } = pruneModelsToAvailable(models, available)
          if (removed.length > 0) {
            models = kept
            await updateStressTestSet(input.datasetId, setIndex, { models: kept })
            logger.info(
              { datasetId: input.datasetId, setIndex, removed },
              'stress: pruned models missing from Comfy'
            )
            setProgress({
              lastMessage: `${label}: dropped ${removed.length} missing model(s) no longer in Comfy.`,
              error: undefined
            })
          }
        } catch (err) {
          // Comfy list failed — keep selection; per-model errors still handled below.
          logger.warn({ err, datasetId: input.datasetId }, 'stress: could not refresh Comfy model list')
        }

        if (models.length === 0) {
          setProgress({
            lastMessage: `${label}: skipped — no models left after removing missing ones.`,
            error: undefined
          })
          setIndex += 1
          continue
        }

        const stemByModel = modelPreviewStemMap(models)
        const existingLower = new Set<string>()
        for (const modelName of models) {
          const mapped = stemByModel.get(modelName) ?? modelName
          for (const candidate of previewStemsForModel(modelName, mapped)) {
            const previewStemPath = join(dsNow.folderPath, 'output', label, candidate)
            if (await hasPreviewImage(previewStemPath)) {
              existingLower.add(candidate.toLowerCase())
              existingLower.add(mapped.toLowerCase())
              break
            }
          }
        }
        const pending = modelsMissingPreviews(models, existingLower)
        const haveCount = models.length - pending.length
        setProgress({ jobsTotal: pending.length })

        if (pending.length === 0) {
          setProgress({
            lastMessage: `${label}: all ${models.length} selected models already have previews.`,
            error: undefined
          })
          setIndex += 1
          continue
        }

        setProgress({
          lastMessage: `${label}: ${pending.length} model(s) need previews (${haveCount}/${models.length} done)…`,
          error: undefined
        })

        for (const modelName of pending) {
          if (cancelled) break
          const setsNow = await listStressTestSets(input.datasetId)
          const setNow = setsNow[setIndex] ?? set
          if (!setNow.models.includes(modelName)) continue

          const config: ValidationRunConfig = {
            datasetId: input.datasetId,
            setIndex,
            prompt: setNow.prompt,
            seed: setNow.seed,
            loraWeight: setNow.loraWeight,
            styleIndex: setNow.styleIndex === 1 ? 1 : 0,
            validationModel: modelName,
            existingCopyPolicy: setNow.existingCopyPolicy
          }
          const previewStem = stemByModel.get(modelName) ?? modelName

          try {
            const done = await runOneModelJob({
              adapter,
              datasetFolder: dsNow.folderPath,
              config,
              target,
              modelName,
              setLabel: label,
              previewStem,
              datasetSubfolder: ''
            })
            if (cancelled) break
            const completed = progress.jobsCompleted + 1
            setProgress({
              jobsCompleted: completed,
              currentModel: modelName,
              lastMessage: `${label} · completed #${completed} · ${modelName}`,
              lastPreviewRelativePath: done.previewRelativePath,
              lastPreviewFileName: modelName,
              comfyNodeTitle: null,
              comfyStep: null,
              comfyMax: null,
              comfyDetail: null
            })
            broadcast({
              type: 'stress-previews-changed',
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
              // Comfy down — cannot continue the rest of the models.
              message = formatComfyConnectError(settings.comfy, err)
              const withModel = `${label} · ${modelName}: ${message}`
              outcome = 'error'
              setProgress({
                status: 'error',
                error: withModel,
                lastMessage: withModel,
                currentModel: modelName
              })
              return
            }
            const short = shortenComfyError(message)
            if (isMissingComfyModelError(short) || isMissingComfyModelError(message)) {
              // File gone mid-run — drop from selection, do not count as a failure.
              const without = setNow.models.filter((m) => m !== modelName)
              await updateStressTestSet(input.datasetId, setIndex, { models: without }).catch(
                (persistErr) => {
                  logger.warn({ persistErr, modelName }, 'stress: failed to drop missing model')
                }
              )
              logger.info(
                { datasetId: input.datasetId, setIndex, modelName, short },
                'stress: skipped missing Comfy model'
              )
              setProgress({
                status: 'running',
                currentModel: modelName,
                lastMessage: `${label}: skipped missing model ${modelName}`,
                error: undefined,
                comfyNodeTitle: null,
                comfyStep: null,
                comfyMax: null,
                comfyDetail: null
              })
              continue
            }
            failedModels.push({ setLabel: label, modelName, error: short })
            logger.warn(
              { err, datasetId: input.datasetId, setIndex, modelName, short },
              'stress model failed — skipping to next'
            )
            setProgress({
              status: 'running',
              currentModel: modelName,
              lastMessage: `FAILED · ${modelName}: ${short}`,
              error: `FAILED · ${modelName}: ${short}`,
              comfyNodeTitle: null,
              comfyStep: null,
              comfyMax: null,
              comfyDetail: null
            })
            // Keep going — other models in this set / later sets still run.
            continue
          }
        }

        setIndex += 1
      }

      if (cancelled) {
        outcome = 'cancelled'
        setProgress({ status: 'cancelled', lastMessage: 'Cancelled' })
      } else if (failedModels.length > 0) {
        outcome = 'error'
        const summary =
          `Stress finished with ${failedModels.length} model failure(s):\n` +
          failedModels.map((f) => `· ${f.setLabel} · ${f.modelName}: ${f.error}`).join('\n')
        setProgress({
          status: 'error',
          error: summary,
          lastMessage: summary,
          currentModel: null,
          comfyNodeTitle: null,
          comfyStep: null,
          comfyMax: null,
          comfyDetail: null
        })
      } else {
        setProgress({
          status: 'done',
          lastMessage: 'All stress-test sets complete.',
          error: undefined,
          currentModel: null
        })
      }
    } catch (err) {
      // Unexpected throw outside per-model catch — do not report success.
      outcome = 'error'
      const message = errorMessage(err)
      logger.warn({ err, datasetId: input.datasetId }, 'stress run aborted unexpectedly')
      setProgress({ status: 'error', error: message, lastMessage: message })
    } finally {
      running = false
      await onPreviewRunFinished(
        { datasetId: input.datasetId, kind: 'stress' },
        outcome
      ).catch((err) => {
        logger.warn({ err }, 'preview continuum: onPreviewRunFinished failed')
      })
    }
  })()

  return { started: true }
}
