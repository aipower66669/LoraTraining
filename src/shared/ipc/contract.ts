import type { AppError } from '../errors'

export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AppError }

export function ok<T>(value: T): IpcResult<T> {
  return { ok: true, value }
}

export function fail<T = never>(error: AppError): IpcResult<T> {
  return { ok: false, error }
}

export const IpcChannels = {
  system: {
    getVersion: 'system:getVersion',
    chooseFolder: 'system:chooseFolder',
    chooseFile: 'system:chooseFile',
    openPath: 'system:openPath',
    /** Absolute file URL for the Pinterest webview guest preload. */
    imageScraperGuestPreloadUrl: 'system:imageScraperGuestPreloadUrl',
    /** Empty Release folder checks GitHub; a folder scans local Setup exes. */
    checkForUpdate: 'system:checkForUpdate',
    /** Launch the newest Setup exe (downloading it from GitHub when the folder is empty), then quit. */
    installUpdate: 'system:installUpdate',
    /** Markdown release notes for a version found by Check for update. */
    getReleaseNotes: 'system:getReleaseNotes'
  },
  settings: {
    get: 'settings:get',
    set: 'settings:set',
    export: 'settings:export',
    import: 'settings:import'
  },
  datasets: {
    list: 'datasets:list',
    get: 'datasets:get',
    create: 'datasets:create',
    update: 'datasets:update',
    remove: 'datasets:remove',
    deleteForever: 'datasets:deleteForever',
    rescan: 'datasets:rescan',
    openFolder: 'datasets:openFolder',
    revealImage: 'datasets:revealImage',
    revealRelativePath: 'datasets:revealRelativePath',
    listOutputs: 'datasets:listOutputs',
    getValidationRating: 'datasets:getValidationRating',
    setValidationRating: 'datasets:setValidationRating',
    deleteValidationPreview: 'datasets:deleteValidationPreview',
    deleteImage: 'datasets:deleteImage',
    convertImagesToJpg: 'datasets:convertImagesToJpg',
    shrinkImagesToMax: 'datasets:shrinkImagesToMax',
    setCheckpointKeepInComfy: 'datasets:setCheckpointKeepInComfy',
    moveCheckpointInComfy: 'datasets:moveCheckpointInComfy',
    listComfyLoraSubfolders: 'datasets:listComfyLoraSubfolders',
    clearOutput: 'datasets:clearOutput',
    createInCategory: 'datasets:createInCategory',
    createFromImage: 'datasets:createFromImage',
    duplicate: 'datasets:duplicate',
    importFiles: 'datasets:importFiles',
    importFromUrl: 'datasets:importFromUrl',
    transferImages: 'datasets:transferImages',
    /** User-only: mark Validated dataset Done after wildcard LoRA-ref check. */
    markDone: 'datasets:markDone'
  },
  categories: {
    list: 'categories:list',
    create: 'categories:create',
    update: 'categories:update',
    remove: 'categories:remove',
    reorder: 'categories:reorder'
  },
  captions: {
    get: 'captions:get',
    set: 'captions:set',
    clear: 'captions:clear',
    bulkTransform: 'captions:bulkTransform',
    applyIdentityTags: 'captions:applyIdentityTags',
    validateReady: 'captions:validateReady'
  },
  jobs: {
    list: 'jobs:list',
    get: 'jobs:get',
    create: 'jobs:create',
    getCreateDefaults: 'jobs:getCreateDefaults',
    update: 'jobs:update',
    duplicate: 'jobs:duplicate',
    remove: 'jobs:remove',
    writeYaml: 'jobs:writeYaml',
    exportYamlText: 'jobs:exportYamlText'
  },
  queue: {
    list: 'queue:list',
    enqueue: 'queue:enqueue',
    enqueueMany: 'queue:enqueueMany',
    remove: 'queue:remove',
    reorder: 'queue:reorder',
    start: 'queue:start',
    pause: 'queue:pause',
    resume: 'queue:resume',
    stop: 'queue:stop',
    stopAfterCurrent: 'queue:stopAfterCurrent',
    retry: 'queue:retry',
    restartClear: 'queue:restartClear'
  },
  tools: {
    testJoyCaption: 'tools:testJoyCaption',
    testAiToolkit: 'tools:testAiToolkit',
    runJoyCaption: 'tools:runJoyCaption',
    cancelToolRun: 'tools:cancelToolRun',
    editInPhotoshop: 'tools:editInPhotoshop'
  },
  imageEdit: {
    readForEdit: 'imageEdit:readForEdit',
    save: 'imageEdit:save',
    saveAs: 'imageEdit:saveAs',
    ensureLamaModel: 'imageEdit:ensureLamaModel',
    getState: 'imageEdit:getState',
    undoLast: 'imageEdit:undoLast',
    revertOriginal: 'imageEdit:revertOriginal'
  },
  comfy: {
    testConnection: 'comfy:testConnection',
    launch: 'comfy:launch',
    listModels: 'comfy:listModels',
    saveWorkflow: 'comfy:saveWorkflow',
    getWorkflow: 'comfy:getWorkflow',
    startValidation: 'comfy:startValidation',
    cancelValidation: 'comfy:cancelValidation',
    getValidationProgress: 'comfy:getValidationProgress',
    listValidationSets: 'comfy:listValidationSets',
    addValidationSet: 'comfy:addValidationSet',
    updateValidationSet: 'comfy:updateValidationSet',
    removeValidationSet: 'comfy:removeValidationSet',
    clearValidationSetImages: 'comfy:clearValidationSetImages',
    cloneValidationSets: 'comfy:cloneValidationSets',
    startStressTest: 'comfy:startStressTest',
    cancelStressTest: 'comfy:cancelStressTest',
    getStressTestProgress: 'comfy:getStressTestProgress',
    listStressTestSets: 'comfy:listStressTestSets',
    addStressTestSet: 'comfy:addStressTestSet',
    updateStressTestSet: 'comfy:updateStressTestSet',
    removeStressTestSet: 'comfy:removeStressTestSet',
    clearStressTestSetImages: 'comfy:clearStressTestSetImages',
    listStressPreviews: 'comfy:listStressPreviews',
    getStressCompareGrid: 'comfy:getStressCompareGrid',
    updateStressCompareLayout: 'comfy:updateStressCompareLayout',
    startWeightValidation: 'comfy:startWeightValidation',
    cancelWeightValidation: 'comfy:cancelWeightValidation',
    getWeightValidationProgress: 'comfy:getWeightValidationProgress',
    listWeightSets: 'comfy:listWeightSets',
    addWeightSet: 'comfy:addWeightSet',
    updateWeightSet: 'comfy:updateWeightSet',
    removeWeightSet: 'comfy:removeWeightSet',
    clearWeightSetImages: 'comfy:clearWeightSetImages',
    listWeightPreviews: 'comfy:listWeightPreviews',
    getPreviewContinuumActive: 'comfy:getPreviewContinuumActive',
    stopPreviewContinuum: 'comfy:stopPreviewContinuum',
    getLtNodesStatus: 'comfy:getLtNodesStatus',
    installLtPackage: 'comfy:installLtPackage',
    seedLtWorkflows: 'comfy:seedLtWorkflows'
  },
  upscale: {
    getWorkflow: 'upscale:getWorkflow',
    saveWorkflow: 'upscale:saveWorkflow',
    getImageConfig: 'upscale:getImageConfig',
    updateImageConfig: 'upscale:updateImageConfig',
    start: 'upscale:start',
    startAll: 'upscale:startAll',
    revert: 'upscale:revert',
    cancel: 'upscale:cancel',
    getProgress: 'upscale:getProgress'
  },
  diversify: {
    getWorkflow: 'diversify:getWorkflow',
    saveWorkflow: 'diversify:saveWorkflow',
    getConfig: 'diversify:getConfig',
    updateConfig: 'diversify:updateConfig',
    start: 'diversify:start',
    startAll: 'diversify:startAll',
    cancel: 'diversify:cancel',
    getProgress: 'diversify:getProgress'
  },
  wildcards: {
    listKeys: 'wildcards:listKeys'
  },
  events: {
    subscribe: 'events:subscribe'
  }
} as const

export type AppEventType =
  | 'job-updated'
  | 'queue-updated'
  | 'process-log'
  | 'process-metrics'
  | 'tool-run-updated'
  | 'validation-progress'
  | 'validation-previews-changed'
  | 'stress-progress'
  | 'stress-previews-changed'
  | 'weight-progress'
  | 'weight-previews-changed'
  | 'preview-continuum'
  | 'upscale-progress'
  | 'diversify-progress'
  | 'dataset-folder-changed'
  | 'category-datasets-changed'
  | 'datasets-list-partial'
  | 'library-load-progress'
  | 'caption-progress'

export type AppEvent =
  | { type: 'job-updated'; payload: { jobId: string; status: string; progress?: JobProgress | null; datasetId?: string } }
  /** Full snapshot — avoids a racy queue.list() round-trip in the renderer. */
  | { type: 'queue-updated'; payload: QueueSnapshot }
  | {
      type: 'process-log'
      payload: { jobId?: string; runId?: string; stream: 'stdout' | 'stderr'; line: string }
    }
  | { type: 'process-metrics'; payload: { jobId: string; progress: JobProgress } }
  | {
      type: 'tool-run-updated'
      payload: { runId: string; status: string; message?: string }
    }
  | {
      type: 'validation-progress'
      payload: import('../comfy').ValidationProgress
    }
  | {
      type: 'validation-previews-changed'
      payload: { datasetId: string; setIndex?: number | null }
    }
  | {
      type: 'stress-progress'
      payload: import('../comfy').StressTestProgress
    }
  | {
      type: 'stress-previews-changed'
      payload: { datasetId: string; setIndex?: number | null }
    }
  | {
      type: 'weight-progress'
      payload: import('../comfy').WeightValidationProgress
    }
  | {
      type: 'weight-previews-changed'
      payload: { datasetId: string; setIndex?: number | null }
    }
  | {
      type: 'preview-continuum'
      payload: { active: boolean }
    }
  | {
      type: 'upscale-progress'
      payload: import('../comfy').UpscaleProgress
    }
  | {
      type: 'diversify-progress'
      payload: import('../comfy').DiversifyProgress
    }
  | {
      type: 'dataset-folder-changed'
      payload: {
        datasetId: string
        /** When set, patch library tile without opening the dataset. */
        trained?: boolean
        validated?: boolean
        done?: boolean
      }
    }
  | {
      type: 'category-datasets-changed'
      payload: { categoryId: string | null }
    }
  | {
      /** Progressive library list: sticky sidecars first, then enriched summaries. */
      type: 'datasets-list-partial'
      payload: {
        listToken: number
        phase: 'sticky' | 'enrich'
        datasets: DatasetSummary[]
      }
    }
  | {
      /** Discovery / enrich progress while `datasets.list` runs. */
      type: 'library-load-progress'
      payload: import('../library-load-progress').LibraryLoadProgress & {
        listToken: number
      }
    }
  | {
      type: 'caption-progress'
      payload: import('../caption-progress').CaptionRunProgress
    }

export interface JobProgress {
  currentStep?: number
  totalSteps?: number
  percent?: number
  /** Dataset pass / epoch when reported (or inferred from tqdm bar stub). */
  pass?: number
  elapsedMs: number
  pausedMs: number
  etaMs?: number
  avgStepMs?: number
  stepsPerSecond?: number
  secondsPerStep?: number
  learningRate?: number
  loss?: number
  lastMessage?: string
  updatedAt: string
}

export interface VersionInfo {
  version: string
  electron: string
  node: string
}

export type ScreenId = 'datasets' | 'jobs' | 'queue' | 'settings'

export type BulkOp =
  | { op: 'prefix'; value: string; createMissing?: boolean }
  | { op: 'suffix'; value: string; createMissing?: boolean }
  | { op: 'replace'; find: string; replace: string }
  | { op: 'remove'; value: string }
  | { op: 'ensureTrigger'; mode: 'prepend' | 'append'; trigger?: string }
  | { op: 'stripTrigger'; trigger?: string }
  | {
      op: 'setText'
      value: string
      mode: 'missing' | 'overwrite' | 'append'
      prependTrigger?: boolean
      trigger?: string
    }

export interface BulkTransformResult {
  changed: number
  skipped: number
  dryRun: boolean
  samples: Array<{ fileName: string; before: string; after: string }>
}

export interface ApplyIdentityTagsResult {
  processed: number
  tagged: number
  skipped: number
  removed: number
  mode: 'missing' | 'redo' | 'remove'
}

export interface ImageEntry {
  fileName: string
  stem: string
  captionExists: boolean
  captionPreview?: string
  mtimeMs: number
  /** Source file size in bytes (for thumb cache busting). */
  sizeBytes: number
  /**
   * True when tip ADS versions exist (`VER_COUNT ≥ 1`).
   * Kept name `hasOriginal` for UI compatibility (Revert / Upscale compare).
   */
  hasOriginal: boolean
  /** Tip stack depth (`VER_COUNT`); 0 when no versions. */
  versionCount: number
  /**
   * Whether this image was used as the source for “Create New Dataset”
   * (`dataset.json` → `spawnedFromImages`).
   */
  hasSpawned: boolean
}

export interface DatasetStats {
  images: number
  captions: number
  stemCollisions: string[]
}

/** Highest-priority lifecycle badge for explorer cards. */
export type DatasetLifecycleStatus =
  | 'none'
  | 'ready'
  | 'queued'
  | 'trained'
  | 'validated'
  | 'done'

export interface DatasetSummary {
  id: string
  name: string
  folderPath: string
  categoryId: string
  trigger: string
  stats: DatasetStats
  updatedAt: string
  coverFileName: string | null
  ready: boolean
  /**
   * Sticky once training produced output (job complete or scan finds `.safetensors`).
   * Cleared when training/validation output is wiped.
   */
  trained: boolean
  /**
   * Completeness: every Validation Steps set has previews for every keep-in-Comfy
   * checkpoint. Demoted when incomplete. Independent of `trained` except Validated
   * implies Trained in the UI.
   */
  validated: boolean
  /**
   * Sticky only after explicit user “Mark as Done” (requires Validated + wildcard
   * LoRA reference). Cleared when Validated demotes.
   */
  done: boolean
  status: DatasetLifecycleStatus
}

export interface DatasetDetail extends DatasetSummary {
  captionExt: string
  notes: string
  /** JoyCaption DATASET CONTEXT guidance. */
  captionGuidance: string
  createdAt: string
  images: ImageEntry[]
}

export interface CheckpointEntry {
  fileName: string
  relativePath: string
  sizeBytes: number
  mtimeMs: number
  /** First available preview under any Set folder (legacy / list hint). */
  validationImageRelativePath: string | null
  /** Previews keyed by set label, paths relative to dataset root after listOutputs prefix. */
  validationImages: Array<{ setLabel: string; relativePath: string }>
  /** Mean of rated set previews (0–5); null if none rated. */
  averageRating: number | null
  /** How many sets have a rating for this checkpoint. */
  ratingCount: number
  /**
   * When true (default), validation may stage this LoRA into ComfyUI and generate
   * new Set previews. Unticked checkpoints are skipped and removed from the Comfy folder.
   */
  keepInComfy: boolean
  /** Relative folder under Comfy models/loras where this LoRA is staged (if known). */
  comfyRelativeDir: string | null
  /**
   * Planned by an open job (draft/queued/running/paused) but `.safetensors` not on disk yet.
   * Further training beyond current output — also demotes Validated.
   */
  pending?: boolean
}

export interface DatasetOutputs {
  trainingFolder: string
  checkpoints: CheckpointEntry[]
}

export function datasetLifecycleStatus(flags: {
  ready: boolean
  trained: boolean
  validated: boolean
  done?: boolean
}): DatasetLifecycleStatus {
  if (flags.done) return 'done'
  if (flags.validated) return 'validated'
  if (flags.trained) return 'trained'
  if (flags.ready) return 'ready'
  return 'none'
}

export interface CategorySummary {
  id: string
  name: string
  sortOrder: number
  /** Relative path under libraryRoot (may be nested, e.g. Group/Category). */
  folder?: string
  /** Absolute category root for auto-discovery; empty = manual datasets. */
  folderPath: string
  createdAt: string
  updatedAt: string
}

export type JobStatus =
  | 'draft'
  | 'queued'
  | 'running'
  | 'paused'
  | 'complete'
  | 'failed'
  | 'cancelled'

export interface JobSummary {
  id: string
  name: string
  datasetId: string
  status: JobStatus
  archived: boolean
  updatedAt: string
  progress: JobProgress | null
  lastError: string | null
  /** Planned training steps from config (or live progress total when known). */
  totalSteps: number
  /**
   * Highest step from a numbered `.safetensors` in the training output folder
   * (e.g. 500 from `name_000000500.safetensors`). 0 when none yet.
   */
  checkpointStep: number
  /** `config.save.save_every` — checkpoint interval for pending-step UI. */
  saveEvery: number
}

export interface JobDetail extends JobSummary {
  config: unknown
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  yamlPath: string | null
  queueOrder: number | null
}

export interface QueueSnapshot {
  jobIds: string[]
  runningJobId: string | null
  statuses: Record<string, JobStatus>
  /** Planned train.steps per queued job (from config / progress). */
  totalSteps: Record<string, number>
  /**
   * When true, the running job finishes normally but the queue will not
   * auto-advance to the next job (remaining jobs stay queued).
   */
  stopAfterCurrent: boolean
}

export interface ToolTestResult {
  ok: boolean
  message: string
}
