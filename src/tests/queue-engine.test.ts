import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JobRecordSchema, type JobRecord } from '@shared/schemas/job'
import { TrainingConfigSchema } from '@shared/schemas/training-config'

// Quiet the real pino logger (engine.ts logs on nearly every state transition).
process.env.LORA_LOG_LEVEL = 'silent'

/**
 * `src/main/queue/engine.ts` is the FIFO/pause/resume/crash-recovery state
 * machine for training jobs. These tests exercise it directly (not the pure
 * helpers already covered by queue-hydrate.test.ts / queue-eta.test.ts) by
 * mocking `node:child_process.spawn` to control the "training process" and
 * mocking the store/event/process-kill modules engine.ts depends on, so the
 * engine's own orchestration logic runs for real against an in-memory job map.
 */

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  pid: number
  constructor(pid: number) {
    super()
    this.pid = pid
  }
}

let nextPid = 1000
let spawnedChildren: FakeChildProcess[] = []
let spawnCalls: Array<{ cmd: string; args: string[] }> = []
let killProcessTreeCalls: number[] = []
let jobs = new Map<string, JobRecord>()
let datasetFolder = ''
const tempDirs: string[] = []

async function freshTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function latestChild(): FakeChildProcess {
  const child = spawnedChildren[spawnedChildren.length - 1]
  if (!child) throw new Error('no training process was spawned')
  return child
}

/** Drain the microtask/macrotask queue so the async IIFE inside child.on('exit') settles. */
async function flushAsync(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve()
    await new Promise((r) => setImmediate(r))
  }
}

/**
 * The exit handler's async IIFE does real fs work (renameFinalCheckpoint's
 * readdir, a dynamic import for ETA calc) on top of the mocked stores, so a
 * fixed number of ticks isn't always enough. Poll the condition instead.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: condition did not become true in time')
    }
    await new Promise((r) => setTimeout(r, 10))
  }
}

function makeConfig(steps = 5) {
  return TrainingConfigSchema.parse({
    name: 'test-job',
    training_folder: join(datasetFolder, 'output'),
    datasets: [{ folder_path: datasetFolder }],
    model: { name_or_path: 'test-model' },
    train: { steps }
  })
}

function makeJob(id: string, overrides: Partial<JobRecord> = {}): JobRecord {
  const now = new Date().toISOString()
  return JobRecordSchema.parse({
    id,
    name: id,
    datasetId: 'ds1',
    status: 'draft',
    config: makeConfig(),
    createdAt: now,
    updatedAt: now,
    queueOrder: null,
    ...overrides
  })
}

beforeEach(async () => {
  vi.resetModules()
  spawnedChildren = []
  spawnCalls = []
  killProcessTreeCalls = []
  jobs = new Map()
  datasetFolder = await freshTempDir('lora-dataset-')

  vi.doMock('node:child_process', () => ({
    spawn: vi.fn((cmd: string, args: string[] = []) => {
      spawnCalls.push({ cmd, args })
      const child = new FakeChildProcess(nextPid++)
      spawnedChildren.push(child)
      return child
    })
  }))

  vi.doMock('../main/settings/store', () => ({
    loadSettings: vi.fn(async () => ({
      tools: {
        aiToolkit: {
          pythonExecutable: 'python',
          workingDirectory: 'C:/toolkit',
          runScript: 'run.py',
          extraArgs: []
        }
      },
      queue: { allowConcurrentCaptioning: true }
    })),
    ensureJobsDir: vi.fn(async () => freshTempDir('lora-jobs-'))
  }))

  vi.doMock('../main/jobs/store', () => ({
    getJobRecord: vi.fn(async (id: string) => {
      const job = jobs.get(id)
      if (!job) throw new Error(`job not found: ${id}`)
      return job
    }),
    saveJobRecord: vi.fn(async (record: JobRecord) => {
      jobs.set(record.id, record)
      return record
    }),
    patchJobRuntime: vi.fn(async (id: string, patch: Partial<JobRecord>) => {
      const job = jobs.get(id)
      if (!job) throw new Error(`job not found: ${id}`)
      const next = {
        ...job,
        ...patch,
        id: job.id,
        name: job.name,
        datasetId: job.datasetId,
        config: job.config,
        createdAt: job.createdAt
      }
      jobs.set(id, next)
      return next
    }),
    writeYamlForJob: vi.fn(async (id: string) => ({ yamlPath: join(datasetFolder, `${id}.yaml`) })),
    listJobs: vi.fn(async () => [...jobs.values()]),
    listJobRecords: vi.fn(async () => [...jobs.values()]),
    invalidateJobsCache: vi.fn()
  }))

  vi.doMock('../main/datasets/store', () => ({
    getDatasetRecord: vi.fn(async (id: string) => ({
      id,
      folderPath: datasetFolder,
      trigger: '',
      captionExt: 'txt',
      stats: { images: 1, captions: 1, missingCaptions: 0, stemCollisions: [] }
    })),
    scanFolder: vi.fn(async () => ({
      images: [{ fileName: 'a.jpg', captionExists: true }],
      stats: { images: 1, captions: 1, missingCaptions: 0, stemCollisions: [] }
    })),
    syncDatasetValidatedFlag: vi.fn(async () => false)
  }))

  vi.doMock('../main/events/bus', () => ({ broadcast: vi.fn() }))

  vi.doMock('../main/runners/process-utils', () => ({
    killProcessTree: vi.fn(async (pid: number) => {
      killProcessTreeCalls.push(pid)
    }),
    pythonChildEnv: vi.fn(() => process.env),
    boostChildPriority: vi.fn()
  }))

  // Caption busy includes active spawn OR pending caption jobs (serial queue).
  vi.doMock('../main/runners/joycaption', () => ({ isCaptionBusy: () => false }))

  vi.doMock('../main/queue/training-session', () => ({
    onTrainingProcessStarted: vi.fn(),
    onTrainingQueueIdle: vi.fn()
  }))

  // Import after mocks. Zero inter-job delay so tests stay fast.
  const engine = await import('../main/queue/engine')
  engine.setInterJobDelayMsForTests(0)
})

afterEach(async () => {
  vi.doUnmock('node:child_process')
  vi.doUnmock('../main/settings/store')
  vi.doUnmock('../main/jobs/store')
  vi.doUnmock('../main/datasets/store')
  vi.doUnmock('../main/events/bus')
  vi.doUnmock('../main/runners/process-utils')
  vi.doUnmock('../main/runners/joycaption')
  vi.doUnmock('../main/queue/training-session')
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('queue engine: start / complete / auto-advance', () => {
  it('starts the first queued job, then auto-advances to the next one on a clean exit', async () => {
    const job1 = makeJob('job-1')
    const job2 = makeJob('job-2')
    jobs.set(job1.id, job1)
    jobs.set(job2.id, job2)

    const engine = await import('../main/queue/engine')
    await engine.enqueue(job1.id)
    await engine.enqueue(job2.id)

    const snap = await engine.startQueue()
    expect(snap.runningJobId).toBe(job1.id)
    expect(snap.statuses[job1.id]).toBe('running')
    expect(jobs.get(job1.id)?.status).toBe('running')
    expect(spawnCalls).toHaveLength(1)
    expect(spawnCalls[0]!.cmd).toBe('python')

    latestChild().emit('exit', 0)
    await waitFor(() => spawnCalls.length >= 2)
    await flushAsync()

    expect(jobs.get(job1.id)?.status).toBe('complete')
    expect(jobs.get(job2.id)?.status).toBe('running')
    expect(spawnCalls).toHaveLength(2)

    const snap2 = await engine.listQueue()
    expect(snap2.runningJobId).toBe(job2.id)
    expect(snap2.jobIds).not.toContain(job1.id)
  })

  it('a late error from job 1 does not clear job 2 after auto-advance', async () => {
    const job1 = makeJob('job-1')
    const job2 = makeJob('job-2')
    jobs.set(job1.id, job1)
    jobs.set(job2.id, job2)

    const engine = await import('../main/queue/engine')
    await engine.enqueue(job1.id)
    await engine.enqueue(job2.id)
    await engine.startQueue()

    const child1 = latestChild()
    child1.emit('exit', 0)
    await waitFor(() => spawnCalls.length >= 2)
    await flushAsync()

    expect(jobs.get(job2.id)?.status).toBe('running')
    const runningSnap = await engine.listQueue()
    expect(runningSnap.runningJobId).toBe(job2.id)

    // Spurious late error on the finished child must not idle the queue.
    child1.emit('error', new Error('late EPIPE'))
    await flushAsync()
    await flushAsync()

    expect(jobs.get(job1.id)?.status).toBe('complete')
    expect(jobs.get(job2.id)?.status).toBe('running')
    const snap = await engine.listQueue()
    expect(snap.runningJobId).toBe(job2.id)
  })

  it('a non-zero exit marks the job failed and auto-advances when continueOnFailure is on', async () => {
    const job1 = makeJob('job-1')
    const job2 = makeJob('job-2')
    jobs.set(job1.id, job1)
    jobs.set(job2.id, job2)

    const engine = await import('../main/queue/engine')
    await engine.enqueue(job1.id)
    await engine.enqueue(job2.id)
    await engine.startQueue()

    latestChild().emit('exit', 1)
    await waitFor(() => jobs.get(job1.id)?.status === 'failed')
    await waitFor(() => spawnCalls.length === 2)

    expect(jobs.get(job1.id)?.status).toBe('failed')
    expect(jobs.get(job1.id)?.lastError).toBe('Exit code 1')
    expect(jobs.get(job2.id)?.status).toBe('running')
    expect(spawnCalls).toHaveLength(2)

    const snap = await engine.listQueue()
    expect(snap.runningJobId).toBe(job2.id)
    expect(snap.jobIds).not.toContain(job1.id)
    expect(snap.jobIds).toContain(job2.id)
  })

  it('a non-zero exit does not auto-advance when continueOnFailure is off', async () => {
    vi.doMock('../main/settings/store', () => ({
      loadSettings: vi.fn(async () => ({
        tools: {
          aiToolkit: {
            pythonExecutable: 'python',
            workingDirectory: 'C:/toolkit',
            runScript: 'run.py',
            extraArgs: []
          }
        },
        queue: { allowConcurrentCaptioning: true, continueOnFailure: false }
      })),
      ensureJobsDir: vi.fn(async () => freshTempDir('lora-jobs-'))
    }))
    vi.resetModules()
    const engine = await import('../main/queue/engine')
    engine.setInterJobDelayMsForTests(0)

    const job1 = makeJob('job-1')
    const job2 = makeJob('job-2')
    jobs.set(job1.id, job1)
    jobs.set(job2.id, job2)

    await engine.enqueue(job1.id)
    await engine.enqueue(job2.id)
    await engine.startQueue()

    latestChild().emit('exit', 1)
    await waitFor(() => jobs.get(job1.id)?.status === 'failed')
    await flushAsync()

    expect(jobs.get(job1.id)?.status).toBe('failed')
    expect(jobs.get(job2.id)?.status).toBe('queued')
    expect(spawnCalls).toHaveLength(1)

    const snap = await engine.listQueue()
    expect(snap.runningJobId).toBeNull()
    expect(snap.jobIds).not.toContain(job1.id)
    expect(snap.jobIds).toContain(job2.id)
  })

  it('preflight failure marks failed, logs, and advances to the next job', async () => {
    let commitCalls = 0
    vi.doMock('../main/images/imageEdit', () => ({
      commitDatasetImageVersions: vi.fn(async () => {
        commitCalls += 1
        if (commitCalls === 1) {
          throw {
            code: 'process-failed',
            message: 'Failed to commit image versions (1): a.jpg: file locked',
            remediation: 'Fix disk/ADS access and retry caption or training.'
          }
        }
        return { committed: 0, skipped: 0 }
      })
    }))
    vi.resetModules()
    const engine = await import('../main/queue/engine')
    engine.setInterJobDelayMsForTests(0)

    const job1 = makeJob('job-1')
    const job2 = makeJob('job-2')
    jobs.set(job1.id, job1)
    jobs.set(job2.id, job2)

    await engine.enqueue(job1.id)
    await engine.enqueue(job2.id)
    await engine.startQueue()

    await waitFor(() => jobs.get(job1.id)?.status === 'failed')
    await waitFor(() => spawnCalls.length === 1)

    expect(jobs.get(job1.id)?.status).toBe('failed')
    expect(jobs.get(job1.id)?.lastError).toMatch(/commit image versions/i)
    expect(jobs.get(job2.id)?.status).toBe('running')
    expect(spawnCalls).toHaveLength(1)
    expect(spawnCalls[0]?.args.some((a) => a.includes('job-2'))).toBe(true)

    vi.doUnmock('../main/images/imageEdit')
    vi.resetModules()
    const engine2 = await import('../main/queue/engine')
    engine2.setInterJobDelayMsForTests(0)
  })
})

describe('queue engine: pause / resume', () => {
  it('pause kills the process tree and marks the job paused without advancing the queue', async () => {
    const job1 = makeJob('job-1')
    jobs.set(job1.id, job1)

    const engine = await import('../main/queue/engine')
    await engine.enqueue(job1.id)
    await engine.startQueue()
    expect(spawnCalls).toHaveLength(1)

    await engine.pauseQueue()
    expect(killProcessTreeCalls).toHaveLength(1)
    expect(jobs.get(job1.id)?.status).toBe('paused')

    // The real OS process only actually dies once taskkill/SIGKILL lands.
    latestChild().emit('exit', 1)
    await flushAsync()

    expect(jobs.get(job1.id)?.status).toBe('paused')
    const snap = await engine.listQueue()
    expect(snap.runningJobId).toBeNull()
    expect(snap.jobIds).toContain(job1.id)
  })

  it('resume restarts a paused job at its remembered queue slot', async () => {
    const job1 = makeJob('job-1')
    jobs.set(job1.id, job1)

    const engine = await import('../main/queue/engine')
    await engine.enqueue(job1.id)
    await engine.startQueue()
    await engine.pauseQueue()
    latestChild().emit('exit', 1)
    await flushAsync()

    await engine.resumeQueue()
    expect(spawnCalls).toHaveLength(2)
    expect(jobs.get(job1.id)?.status).toBe('running')
  })
})

describe('queue engine: stop', () => {
  it('stop cancels the running job, removes it from the FIFO, and does not auto-advance', async () => {
    const job1 = makeJob('job-1')
    const job2 = makeJob('job-2')
    jobs.set(job1.id, job1)
    jobs.set(job2.id, job2)

    const engine = await import('../main/queue/engine')
    await engine.enqueue(job1.id)
    await engine.enqueue(job2.id)
    await engine.startQueue()

    await engine.stopQueue()
    expect(killProcessTreeCalls).toHaveLength(1)

    latestChild().emit('exit', 1)
    await flushAsync()

    expect(jobs.get(job1.id)?.status).toBe('cancelled')
    expect(jobs.get(job2.id)?.status).not.toBe('running')

    const snap = await engine.listQueue()
    expect(snap.runningJobId).toBeNull()
  })
})

describe('queue engine: reorder', () => {
  it('keeps the running job pinned at the front regardless of the requested order', async () => {
    const job1 = makeJob('job-1')
    const job2 = makeJob('job-2')
    const job3 = makeJob('job-3')
    jobs.set(job1.id, job1)
    jobs.set(job2.id, job2)
    jobs.set(job3.id, job3)

    const engine = await import('../main/queue/engine')
    await engine.enqueue(job1.id)
    await engine.enqueue(job2.id)
    await engine.enqueue(job3.id)
    await engine.startQueue()

    const snap = await engine.reorderQueue([job3.id, job2.id, job1.id])
    expect(snap.jobIds).toEqual([job1.id, job3.id, job2.id])
  })
})

describe('queue engine: crash recovery', () => {
  it('demotes a disk-persisted "running" job to paused on hydrate and never resumes its dead process', async () => {
    const crashedJob = makeJob('job-1', { status: 'running', queueOrder: 0 })
    jobs.set(crashedJob.id, crashedJob)

    // A freshly imported module mirrors app startup: no spawn has happened yet
    // in this process, and runningJobId/activeChild start out empty.
    const engine = await import('../main/queue/engine')
    const snap = await engine.listQueue()

    expect(snap.runningJobId).toBeNull()
    expect(jobs.get(crashedJob.id)?.status).toBe('paused')
    expect(snap.jobIds).toContain(crashedJob.id)
    expect(spawnCalls).toHaveLength(0)
  })
})
