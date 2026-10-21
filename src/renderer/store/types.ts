import type { CaptionRunProgress } from '@shared/caption-progress'
import type { LibraryLoadProgress } from '@shared/library-load-progress'
import type {
  DiversifyProgress,
  StressTestProgress,
  UpscaleProgress,
  ValidationProgress,
  WeightValidationProgress
} from '@shared/comfy'
import type { DiversifyMode } from '@shared/diversify-config'
import type {
  AppEvent,
  CategorySummary,
  DatasetDetail,
  DatasetSummary,
  JobDetail,
  JobProgress,
  JobSummary,
  QueueSnapshot,
  ScreenId
} from '@shared/ipc/contract'
import type { DatasetStatusFilter } from '@shared/explorer-status'
import type { AppSettings } from '@shared/schemas/settings'

/** One line in the Queue live log (stream drives color; no [stdout]/[stderr] prefix). */
export type ProcessLogLine = {
  stream: 'stdout' | 'stderr'
  line: string
}

export type DatasetsMiddleTab =
  | 'images'
  | 'output'
  | 'validate'
  | 'weight'
  | 'stress'
  | 'upscale'
  | 'context'
  | 'expression'

export type ValidationFocusRequest = {
  datasetId: string
  setIndex: number
  /** Bumps so repeated jumps to the same set still apply. */
  token: number
}

/** "Upscale" from ImageGrid's context menu — jumps to the Upscale tab with this image loaded. */
export type UpscaleOpenRequest = {
  datasetId: string
  fileName: string
  /** Bumps so repeated requests for the same file still apply. */
  token: number
}

/** Current Upscale/Detail tool source image — always a dataset-native file (see plan: external mode dropped). */
export type UpscaleSource = { datasetId: string; fileName: string }

/** "Diversify" from ImageGrid / toolbar — jumps to Context or Expression with this image. */
export type DiversifyOpenRequest = {
  datasetId: string
  fileName: string
  mode: DiversifyMode
  token: number
}

export type DiversifySource = { datasetId: string; fileName: string }

/** In-app Filerobot image editor (Images context menu). */
export type ImageEditorState = {
  datasetId: string
  fileName: string
}

export interface AppState {
  screen: ScreenId
  statusMessage: string
  versionLabel: string
  settings: AppSettings | null
  /**
   * True until the first (or in-flight) refreshAll finishes loading datasets.
   * Explorer shows a loading empty-state instead of “No categories yet”.
   */
  libraryLoading: boolean
  /** Live discovery / enrich progress for the in-flight library refresh. */
  libraryLoadProgress: LibraryLoadProgress | null
  /** Matches listDatasets partial events; ignore stale enrichments from an older refresh. */
  datasetsListToken: number
  categories: CategorySummary[]
  datasets: DatasetSummary[]
  selectedDatasetId: string | null
  datasetDetail: DatasetDetail | null
  selectedImage: string | null
  /** Explorer-style multi-select in the image grid (grid order). */
  selectedImages: string[]
  /** Middle pane tab on Datasets; kept across Jobs/Queue navigation. */
  datasetsMiddleTab: DatasetsMiddleTab
  /**
   * Explorer status filter (All / Not ready / Ready / …).
   * Persisted in localStorage; drives the Datasets nav badge count.
   */
  explorerStatusFilter: DatasetStatusFilter
  /** Right-pane Pinterest image scraper (Datasets screen). */
  imageScraperOpen: boolean
  jobs: JobSummary[]
  selectedJobId: string | null
  jobDetail: JobDetail | null
  queue: QueueSnapshot | null
  /** When set, Queue screen selects this job once (then clears). */
  queueFocusJobId: string | null
  logs: ProcessLogLine[]
  liveProgress: JobProgress | null
  captionProgress: CaptionRunProgress | null
  /** Live LoRA Validation run (null / idle = not validating). */
  validationProgress: ValidationProgress | null
  /** Ask Validate details to select a set after navigation. */
  validationFocusRequest: ValidationFocusRequest | null
  /** Live Validation Weight run. */
  weightProgress: WeightValidationProgress | null
  /** Ask Weight details to select a set after navigation. */
  weightFocusRequest: ValidationFocusRequest | null
  /** Live Model Stress-Testing run. */
  stressProgress: StressTestProgress | null
  /** Ask Stress details to select a set after navigation. */
  stressFocusRequest: ValidationFocusRequest | null
  /** Overnight Steps → Weight → Stress continuum is active (may be between jobs). */
  previewContinuumActive: boolean
  /** Live upscale run (null / idle = not running). */
  upscaleProgress: UpscaleProgress | null
  /** Ask the Upscale middle pane to load this dataset image as the source. */
  upscaleOpenRequest: UpscaleOpenRequest | null
  /** Current Upscale/Detail source image (dataset-native or external), shared between the middle pane and details panel. */
  upscaleSource: UpscaleSource | null
  diversifyProgress: DiversifyProgress | null
  diversifyOpenRequest: DiversifyOpenRequest | null
  diversifySource: DiversifySource | null
  /** Full-window in-app image editor (null = closed). */
  imageEditor: ImageEditorState | null
  /** Bump CaptionEditor when the selected image's caption file was rewritten. */
  captionReloadNonce: number
  error: string | null
  setScreen: (screen: ScreenId) => void
  setStatus: (msg: string) => void
  setError: (msg: string | null) => void
  /** Navigate to Queue and select this job (cleared after Queue applies it). */
  openQueueForJob: (jobId: string) => void
  setDatasetsMiddleTab: (tab: DatasetsMiddleTab) => void
  setExplorerStatusFilter: (filter: DatasetStatusFilter) => void
  setImageScraperOpen: (open: boolean) => void
  setUpscaleSource: (source: UpscaleSource | null) => void
  setDiversifySource: (source: DiversifySource | null) => void
  openImageEditor: (datasetId: string, fileName: string) => void
  closeImageEditor: () => void
  saveEditedImage: (datasetId: string, fileName: string, dataBase64: string) => Promise<void>
  saveEditedImageAs: (
    datasetId: string,
    fileName: string,
    dataBase64: string
  ) => Promise<string | null>
  markImageCaptioned: (fileName: string) => void
  pushLog: (entry: ProcessLogLine) => void
  clearLogs: () => void
  applyEvent: (event: AppEvent) => void
  refreshAll: () => Promise<void>
  /** Refresh jobs + queue only (skips slow datasets.list). */
  refreshJobs: () => Promise<void>
  loadDataset: (id: string, opts?: { preserveCaptionFlags?: boolean }) => Promise<void>
  loadJob: (id: string) => Promise<void>
  /** Jump to the in-progress validation dataset + set (Validation Steps tab). */
  goToActiveValidation: () => Promise<void>
  /** Jump to the in-progress weight-validation dataset + set (Validation Weight tab). */
  goToActiveWeightValidation: () => Promise<void>
  /** Jump to the in-progress stress-test dataset + set (Stress tab). */
  goToActiveStressTest: () => Promise<void>
  /** Jump to whichever preview run is active (steps / weight / stress). */
  goToActivePreviewRun: () => Promise<void>
  /** "Upscale" from ImageGrid: switch to the Upscale tab with this image as source. */
  requestUpscale: (datasetId: string, fileName: string) => Promise<void>
  /** Diversify: switch to Context/Expression with this image as source. */
  requestDiversify: (
    datasetId: string,
    fileName: string,
    mode?: DiversifyMode
  ) => Promise<void>
}

export type AppStateSet = (
  partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)
) => void
export type AppStateGet = () => AppState
