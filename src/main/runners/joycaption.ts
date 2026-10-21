import { spawn, type ChildProcess } from 'node:child_process'
import { access, appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, join } from 'node:path'
import { nanoid } from 'nanoid'
import { appError } from '@shared/errors'
import type { CaptionRunProgress } from '@shared/caption-progress'
import {
  formatCaptionProgressStatus,
  parseCaptionOkLine,
  parseCaptionToProcessLine
} from '@shared/caption-progress'
import {
  captionCancelMatchesSession,
  computeAggregateCaptionProgress,
  type CaptionQueueJob
} from '@shared/caption-queue'
import type { ToolTestResult } from '@shared/ipc/contract'
import {
  buildJoyCaptionArgs,
  mergeAppendedCaption,
  type JoyCaptionExistingMode
} from '@shared/joycaption'
import { resolveJoyCaptionScriptPath } from './joycaption-script-path'
import { imageStem } from '@shared/schemas/dataset'
import { broadcast } from '../events/bus'
import { getDatasetRecord, rescanDataset, scanFolder } from '../datasets/store'
import { logger } from '../logging'
import { ensureJobsDir, loadSettings } from '../settings/store'
import { atomicWriteFile } from '../security/atomic-write'
import { assertInsideRoot } from '../security/path-guards'
import { killProcessTree, pythonChildEnv } from './process-utils'
import { resolvePythonExecutable, resolveScriptPath, resolveVenvActivateBat, buildCmdVenvPythonCommand } from './resolve-python'

interface ActiveRun {
  runId: string
  datasetId: string
  child: ChildProcess
  status: 'running' | 'complete' | 'failed' | 'cancelled'
  workFileNames: string[]
  completed: number
  currentIndex: number
  completedNames: string[]
  stdoutBuf: string
  stderrBuf: string
  /** Append mode: prior caption text keyed by lowercase image fileName. */
  priorCaptions: Map<string, string> | null
  folderPath: string
  captionExt: string
  /** In-flight append merges so exit can wait before rescan. */
  pendingMerges: Promise<void>[]
}

const pendingJobs: CaptionQueueJob[] = []
let activeRun: ActiveRun | null = null
/** Images finished in prior jobs of this session (not including active). */
let sessionCompleted = 0
/** Prevent overlapping pump() starts. */
let pumpScheduled = false

export function isCaptionBusy(): boolean {
  return activeRun != null || pendingJobs.length > 0 || pumpScheduled
}

/** Test helper: reset in-memory queue state (vitest only). */
export function _resetCaptionQueueForTests(): void {
  pendingJobs.length = 0
  activeRun = null
  sessionCompleted = 0
  pumpScheduled = false
}

/** Test helper: peek pending jobs. */
export function _getCaptionQueueForTests(): {
  pending: CaptionQueueJob[]
  sessionCompleted: number
  activeRunId: string | null
} {
  return {
    pending: [...pendingJobs],
    sessionCompleted,
    activeRunId: activeRun?.runId ?? null
  }
}

export async function testJoyCaption(): Promise<ToolTestResult> {
  const settings = await loadSettings()
  const { pythonExecutable, scriptPath, workingDirectory } = settings.tools.joyCaption
  try {
    const script = resolveJoyCaptionScriptPath(scriptPath, workingDirectory)
    await access(script, constants.F_OK)
    const { exe, source } = await resolvePythonExecutable(pythonExecutable, workingDirectory)
    const version = await runVersionCheck(exe, workingDirectory || undefined)
    if (!version.ok) return version
    return {
      ok: true,
      message: `${version.message} (python: ${exe}${source !== 'explicit' ? `, via ${source}` : ''}; script: ${script})`
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

export async function testAiToolkit(): Promise<ToolTestResult> {
  const settings = await loadSettings()
  const { pythonExecutable, runScript, workingDirectory } = settings.tools.aiToolkit
  try {
    const script = resolveScriptPath(runScript || 'run.py', workingDirectory)
    await access(script, constants.F_OK)
    const { exe, source } = await resolvePythonExecutable(pythonExecutable, workingDirectory)
    const version = await runVersionCheck(exe, workingDirectory || undefined)
    if (!version.ok) return version
    return {
      ok: true,
      message: `${version.message} (python: ${exe}${source !== 'explicit' ? `, via ${source}` : ''})`
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

function runVersionCheck(pythonExecutable: string, cwd?: string): Promise<ToolTestResult> {
  return new Promise((resolve) => {
    const child = spawn(pythonExecutable, ['-V'], {
      cwd,
      windowsHide: true,
      shell: false
    })
    let out = ''
    child.stdout?.on('data', (d: Buffer) => {
      out += d.toString()
    })
    child.stderr?.on('data', (d: Buffer) => {
      out += d.toString()
    })
    child.on('error', (err) => {
      resolve({ ok: false, message: err.message })
    })
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ ok: true, message: out.trim() || 'python OK' })
      } else {
        resolve({ ok: false, message: out.trim() || `exit ${code}` })
      }
    })
  })
}

export async function listWorkFileNames(
  folderPath: string,
  mode: JoyCaptionExistingMode,
  captionExt: string
): Promise<string[]> {
  const { images } = await scanFolder(folderPath, captionExt)
  const sorted = [...images].sort((a, b) => a.fileName.localeCompare(b.fileName))
  if (mode === 'overwrite' || mode === 'append') return sorted.map((i) => i.fileName)
  return sorted.filter((i) => !i.captionExists).map((i) => i.fileName)
}

/** Snapshot existing caption bodies before `--redo` so Append can merge afterward. */
async function snapshotPriorCaptions(
  folderPath: string,
  fileNames: string[],
  captionExt: string
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (const fileName of fileNames) {
    const stem = imageStem(fileName)
    const capPath = assertInsideRoot(folderPath, join(folderPath, `${stem}.${captionExt}`))
    try {
      const text = await readFile(capPath, 'utf8')
      if (text.replace(/^\uFEFF/, '').trim()) {
        map.set(fileName.toLowerCase(), text)
      }
    } catch {
      /* missing — leave out of map */
    }
  }
  return map
}

async function mergeAppendedCaptionFile(run: ActiveRun, fileName: string): Promise<void> {
  if (!run.priorCaptions) return
  const prior = run.priorCaptions.get(fileName.toLowerCase())
  if (prior == null) return
  const stem = imageStem(fileName)
  const capPath = assertInsideRoot(run.folderPath, join(run.folderPath, `${stem}.${run.captionExt}`))
  let generated = ''
  try {
    generated = await readFile(capPath, 'utf8')
  } catch (err) {
    logger.warn({ err, fileName }, 'append merge: could not read new caption')
    return
  }
  const merged = mergeAppendedCaption(prior, generated)
  if (merged === generated) return
  try {
    const { muteDatasetFolderWatch } = await import('../datasets/folderWatch')
    muteDatasetFolderWatch(1500)
  } catch {
    /* optional */
  }
  await atomicWriteFile(capPath, merged)
}

function emitCaptionProgress(run: ActiveRun, patch?: Partial<CaptionRunProgress>): void {
  const jobTotal = run.workFileNames.length
  const currentFileName =
    run.status === 'running' && run.currentIndex < jobTotal
      ? run.workFileNames[run.currentIndex] ?? null
      : null
  const lastCompletedFileName =
    run.completedNames.length > 0
      ? run.completedNames[run.completedNames.length - 1]!
      : run.completed > 0
        ? run.workFileNames[run.completed - 1] ?? null
        : null

  const { completed, total } = computeAggregateCaptionProgress({
    sessionCompleted,
    currentCompleted: run.completed,
    currentTotal: jobTotal,
    pendingPlannedTotals: pendingJobs.map((j) => j.plannedTotal)
  })

  const payload: CaptionRunProgress = {
    runId: run.runId,
    datasetId: run.datasetId,
    status: run.status,
    total,
    completed,
    currentFileName,
    lastCompletedFileName,
    completedFileNames: [...run.completedNames],
    remainingFileNames: run.workFileNames.slice(Math.max(0, run.currentIndex)),
    pendingJobs: pendingJobs.length,
    pendingJobSummaries: pendingJobs.map((j) => ({
      runId: j.runId,
      datasetId: j.datasetId,
      mode: j.mode,
      plannedTotal: j.plannedTotal,
      prependTrigger: j.prependTrigger
    })),
    ...patch
  }
  // Re-apply aggregates if patch overwrote them unintentionally with job-local values.
  if (patch?.total == null) payload.total = total
  if (patch?.completed == null) payload.completed = completed
  if (patch?.pendingJobs == null) payload.pendingJobs = pendingJobs.length
  if (patch?.remainingFileNames == null) {
    payload.remainingFileNames = run.workFileNames.slice(Math.max(0, run.currentIndex))
  }
  if (patch?.pendingJobSummaries == null) {
    payload.pendingJobSummaries = pendingJobs.map((j) => ({
      runId: j.runId,
      datasetId: j.datasetId,
      mode: j.mode,
      plannedTotal: j.plannedTotal,
      prependTrigger: j.prependTrigger
    }))
  }
  payload.message = formatCaptionProgressStatus(payload)
  broadcast({ type: 'caption-progress', payload })
}

function emitSessionTerminal(
  status: 'complete' | 'failed' | 'cancelled',
  opts: {
    runId: string
    datasetId: string
    completed: number
    total: number
    lastCompletedFileName: string | null
    completedFileNames?: string[]
    message?: string
  }
): void {
  const payload: CaptionRunProgress = {
    runId: opts.runId,
    datasetId: opts.datasetId,
    status,
    total: opts.total,
    completed: opts.completed,
    currentFileName: null,
    lastCompletedFileName: opts.lastCompletedFileName,
    completedFileNames: opts.completedFileNames,
    pendingJobs: 0,
    message: opts.message
  }
  payload.message = formatCaptionProgressStatus(payload)
  broadcast({ type: 'caption-progress', payload })
}

function resetSession(): void {
  pendingJobs.length = 0
  activeRun = null
  sessionCompleted = 0
  pumpScheduled = false
}

/**
 * Enqueue a JoyCaption job. Starts immediately if the queue is idle; otherwise
 * waits in series. Never throws `busy`.
 */
export async function runJoyCaption(
  datasetId: string,
  mode: JoyCaptionExistingMode = 'missing',
  opts?: { guidance?: string | null; prependTrigger?: boolean }
): Promise<{ runId: string; queued: boolean }> {
  const settings = await loadSettings()
  const tool = settings.tools.joyCaption
  if (!tool.scriptPath || !tool.workingDirectory) {
    throw appError('tool-not-configured', 'JoyCaption tools are not configured', {
      remediation: 'Set working directory and script path in Settings. Python is optional.'
    })
  }

  // Fail fast on python resolve so we don't queue a job that cannot start.
  try {
    await resolvePythonExecutable(tool.pythonExecutable, tool.workingDirectory)
  } catch (err) {
    throw appError('tool-not-configured', err instanceof Error ? err.message : String(err), {
      remediation: 'Install Python, add it to PATH, or browse to a venv python.exe.'
    })
  }

  const dataset = await getDatasetRecord(datasetId)
  const workEstimate = await listWorkFileNames(dataset.folderPath, mode, dataset.captionExt)
  const guidance =
    opts?.guidance !== undefined && opts.guidance !== null
      ? opts.guidance.trim()
      : (dataset.captionGuidance ?? '').trim()
  const prependTrigger = Boolean(opts?.prependTrigger)
  const triggerToken = prependTrigger ? dataset.trigger?.trim() || '' : ''

  const runId = nanoid()
  const job: CaptionQueueJob = {
    runId,
    datasetId,
    mode,
    guidance: guidance || null,
    prependTrigger,
    triggerToken,
    plannedTotal: workEstimate.length
  }

  const queued = isCaptionBusy()
  if (!queued) {
    sessionCompleted = 0
  }
  pendingJobs.push(job)
  void pump()
  return { runId, queued }
}

async function pump(): Promise<void> {
  if (activeRun != null || pumpScheduled) return
  const job = pendingJobs.shift()
  if (!job) return

  pumpScheduled = true
  try {
    await beginJob(job)
  } catch (err) {
    pumpScheduled = false
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ err, runId: job.runId }, 'caption job failed to start')
    pendingJobs.length = 0
    const { completed, total } = computeAggregateCaptionProgress({
      sessionCompleted,
      currentCompleted: 0,
      currentTotal: 0,
      pendingPlannedTotals: []
    })
    emitSessionTerminal('failed', {
      runId: job.runId,
      datasetId: job.datasetId,
      completed,
      total: Math.max(total, sessionCompleted),
      lastCompletedFileName: null,
      message
    })
    broadcast({
      type: 'tool-run-updated',
      payload: { runId: job.runId, status: 'failed', message }
    })
    resetSession()
  }
}

async function beginJob(job: CaptionQueueJob): Promise<void> {
  const settings = await loadSettings()
  const tool = settings.tools.joyCaption
  if (!tool.scriptPath || !tool.workingDirectory) {
    throw appError('tool-not-configured', 'JoyCaption tools are not configured')
  }

  const { exe: pythonExe } = await resolvePythonExecutable(
    tool.pythonExecutable,
    tool.workingDirectory
  )

  const dataset = await getDatasetRecord(job.datasetId)

  // Permanently commit tip ADS edits into $DATA so captioning sees final pixels.
  const { commitDatasetImageVersions } = await import('../images/imageEdit')
  const commitResult = await commitDatasetImageVersions(dataset.folderPath)
  if (commitResult.committed > 0) {
    const { invalidateAllDatasetThumbs } = await import('../media/thumbs')
    await invalidateAllDatasetThumbs(job.datasetId, dataset.folderPath)
    broadcast({ type: 'dataset-folder-changed', payload: { datasetId: job.datasetId } })
  }

  const script = resolveJoyCaptionScriptPath(tool.scriptPath, tool.workingDirectory)
  const workFileNames = await listWorkFileNames(dataset.folderPath, job.mode, dataset.captionExt)

  const priorCaptions =
    job.mode === 'append'
      ? await snapshotPriorCaptions(dataset.folderPath, workFileNames, dataset.captionExt)
      : null

  const logDir = join(await ensureJobsDir(), '_caption-runs', job.runId)
  await mkdir(logDir, { recursive: true })
  const logFile = join(logDir, `caption-${Date.now()}.log`)

  let contextFile: string | null = null
  const guidance = (job.guidance ?? '').trim()
  if (guidance) {
    contextFile = join(logDir, 'caption-context.txt')
    await writeFile(contextFile, guidance, 'utf8')
  }

  const scriptArgs = buildJoyCaptionArgs(dataset.folderPath, {
    mode: job.mode,
    extraArgs: tool.extraArgs,
    contextFile,
    triggerToken: job.prependTrigger ? job.triggerToken || null : null
  })

  let child: ChildProcess
  if (tool.invocationMode === 'cmd') {
    const activate = await resolveVenvActivateBat(tool.workingDirectory)
    const cmd = buildCmdVenvPythonCommand({
      activateRelativeCall: activate.relativeCall,
      scriptAbsolute: script,
      workingDirectory: tool.workingDirectory,
      scriptArgs
    })
    child = spawn('cmd.exe', ['/d', '/s', '/c', cmd], {
      cwd: tool.workingDirectory,
      windowsHide: true,
      env: pythonChildEnv()
    })
  } else {
    child = spawn(pythonExe, [script, ...scriptArgs], {
      cwd: tool.workingDirectory || undefined,
      windowsHide: true,
      env: pythonChildEnv()
    })
  }

  const run: ActiveRun = {
    runId: job.runId,
    datasetId: job.datasetId,
    child,
    status: 'running',
    workFileNames,
    completed: 0,
    currentIndex: 0,
    completedNames: [],
    stdoutBuf: '',
    stderrBuf: '',
    priorCaptions,
    folderPath: dataset.folderPath,
    captionExt: dataset.captionExt,
    pendingMerges: []
  }
  activeRun = run
  pumpScheduled = false
  broadcast({ type: 'tool-run-updated', payload: { runId: job.runId, status: 'running' } })
  emitCaptionProgress(run)

  const ingest = (stream: 'stdout' | 'stderr', text: string): void => {
    void appendFile(logFile, text)
    const key = stream === 'stdout' ? 'stdoutBuf' : 'stderrBuf'
    const combined = run[key] + text
    const parts = combined.split(/\n/)
    run[key] = parts.pop() ?? ''
    for (const part of parts) {
      for (const segment of part.split(/\r/)) {
        const line = segment.trimEnd()
        if (!line) continue
        broadcast({ type: 'process-log', payload: { runId: job.runId, stream, line } })
        handleCaptionLogLine(run, line)
      }
    }
  }

  child.stdout?.on('data', (buf: Buffer) => ingest('stdout', buf.toString('utf8')))
  child.stderr?.on('data', (buf: Buffer) => ingest('stderr', buf.toString('utf8')))

  const flushBuffers = (): void => {
    for (const stream of ['stdout', 'stderr'] as const) {
      const key = stream === 'stdout' ? 'stdoutBuf' : 'stderrBuf'
      const leftover = run[key].trim()
      run[key] = ''
      if (!leftover) continue
      for (const segment of leftover.split(/\r/)) {
        const line = segment.trimEnd()
        if (!line) continue
        broadcast({ type: 'process-log', payload: { runId: job.runId, stream, line } })
        handleCaptionLogLine(run, line)
      }
    }
  }

  child.on('exit', (code) => {
    flushBuffers()
    void finishJob(run, code)
  })

  child.on('error', (err) => {
    void finishJob(run, 1, err.message)
  })
}

async function finishJob(
  run: ActiveRun,
  code: number | null,
  errorMessage?: string
): Promise<void> {
  if (activeRun?.runId !== run.runId) return

  if (run.pendingMerges.length > 0) {
    await Promise.all(run.pendingMerges)
  }

  const lastCompletedFileName =
    run.completedNames.length > 0
      ? run.completedNames[run.completedNames.length - 1]!
      : null

  if (run.status === 'cancelled') {
    const { completed, total } = computeAggregateCaptionProgress({
      sessionCompleted,
      currentCompleted: run.completed,
      currentTotal: run.workFileNames.length,
      pendingPlannedTotals: []
    })
    emitSessionTerminal('cancelled', {
      runId: run.runId,
      datasetId: run.datasetId,
      completed,
      total,
      lastCompletedFileName,
      completedFileNames: [...run.completedNames]
    })
    broadcast({
      type: 'tool-run-updated',
      payload: { runId: run.runId, status: 'cancelled', message: 'Cancelled' }
    })
    resetSession()
    return
  }

  if (code !== 0 || errorMessage) {
    run.status = 'failed'
    pendingJobs.length = 0
    const { completed, total } = computeAggregateCaptionProgress({
      sessionCompleted,
      currentCompleted: run.completed,
      currentTotal: run.workFileNames.length,
      pendingPlannedTotals: []
    })
    const message = errorMessage ?? `Exit code ${code}`
    emitSessionTerminal('failed', {
      runId: run.runId,
      datasetId: run.datasetId,
      completed,
      total,
      lastCompletedFileName,
      completedFileNames: [...run.completedNames],
      message
    })
    broadcast({
      type: 'tool-run-updated',
      payload: { runId: run.runId, status: 'failed', message }
    })
    resetSession()
    return
  }

  run.status = 'complete'
  run.currentIndex = run.workFileNames.length
  run.completed = Math.max(run.completed, run.completedNames.length, run.workFileNames.length)
  sessionCompleted += run.completed

  try {
    await rescanDataset(run.datasetId)
    broadcast({
      type: 'tool-run-updated',
      payload: { runId: run.runId, status: 'complete', message: 'Captions updated' }
    })
  } catch (err) {
    logger.warn({ err }, 'post-caption rescan failed')
  }

  activeRun = null

  if (pendingJobs.length > 0) {
    // Keep sessionCompleted; start next job. Emit interim progress with pending totals.
    const next = pendingJobs[0]!
    const { completed, total } = computeAggregateCaptionProgress({
      sessionCompleted,
      currentCompleted: 0,
      currentTotal: next.plannedTotal,
      pendingPlannedTotals: pendingJobs.slice(1).map((j) => j.plannedTotal)
    })
    broadcast({
      type: 'caption-progress',
      payload: {
        runId: next.runId,
        datasetId: next.datasetId,
        status: 'running',
        total,
        completed,
        currentFileName: null,
        lastCompletedFileName,
        remainingFileNames: [],
        pendingJobs: pendingJobs.length,
        pendingJobSummaries: pendingJobs.map((j) => ({
          runId: j.runId,
          datasetId: j.datasetId,
          mode: j.mode,
          plannedTotal: j.plannedTotal,
          prependTrigger: j.prependTrigger
        })),
        message: formatCaptionProgressStatus({
          runId: next.runId,
          datasetId: next.datasetId,
          status: 'running',
          total,
          completed,
          currentFileName: null,
          lastCompletedFileName,
          pendingJobs: pendingJobs.length
        })
      }
    })
    void pump()
    return
  }

  emitSessionTerminal('complete', {
    runId: run.runId,
    datasetId: run.datasetId,
    completed: sessionCompleted,
    total: sessionCompleted,
    lastCompletedFileName,
    completedFileNames: [...run.completedNames]
  })
  resetSession()
}

function handleCaptionLogLine(run: ActiveRun, line: string): void {
  if (run.status !== 'running') return

  const toProcess = parseCaptionToProcessLine(line)
  if (toProcess != null && toProcess !== run.workFileNames.length && toProcess >= 0) {
    if (toProcess === 0) {
      run.workFileNames = []
      emitCaptionProgress(run)
      return
    }
  }

  const okName = parseCaptionOkLine(line)
  if (!okName) return

  const expected = run.workFileNames[run.currentIndex]
  let completedName = okName
  if (expected && basename(expected).toLowerCase() === okName.toLowerCase()) {
    completedName = expected
    run.completed = run.currentIndex + 1
    run.currentIndex += 1
  } else {
    const idx = run.workFileNames.findIndex(
      (f) => f.toLowerCase() === okName.toLowerCase() || basename(f).toLowerCase() === okName.toLowerCase()
    )
    if (idx >= 0) {
      completedName = run.workFileNames[idx]!
      run.completed = Math.max(run.completed, idx + 1)
      run.currentIndex = Math.max(run.currentIndex, idx + 1)
    } else {
      run.completed += 1
      run.currentIndex = Math.max(run.currentIndex, run.completed)
    }
  }

  rememberCompleted(run, completedName)
  if (run.priorCaptions) {
    const merge = mergeAppendedCaptionFile(run, completedName).catch((err) =>
      logger.warn({ err, fileName: completedName }, 'append merge failed')
    )
    run.pendingMerges.push(merge)
  }
  emitCaptionProgress(run, { lastCompletedFileName: completedName })
}

function rememberCompleted(run: ActiveRun, fileName: string): void {
  if (!run.completedNames.some((n) => n.toLowerCase() === fileName.toLowerCase())) {
    run.completedNames.push(fileName)
  }
}

/**
 * Cancel the active caption job (if any) and clear the entire pending queue.
 * `runId` must match the active job or any pending job.
 */
export async function cancelToolRun(runId: string): Promise<{ cancelled: true }> {
  const pendingIds = pendingJobs.map((j) => j.runId)
  const activeId = activeRun?.runId ?? null
  if (!captionCancelMatchesSession(runId, activeId, pendingIds)) {
    throw appError('not-found', `No active tool run: ${runId}`)
  }

  pendingJobs.length = 0

  if (activeRun && activeRun.child.pid) {
    activeRun.status = 'cancelled'
    emitCaptionProgress(activeRun)
    await killProcessTree(activeRun.child.pid)
    // finishJob on exit will emit terminal cancelled + resetSession
    return { cancelled: true }
  }

  // Pending-only (or race before spawn): emit cancelled and reset.
  emitSessionTerminal('cancelled', {
    runId,
    datasetId: '',
    completed: sessionCompleted,
    total: sessionCompleted,
    lastCompletedFileName: null
  })
  resetSession()
  return { cancelled: true }
}
