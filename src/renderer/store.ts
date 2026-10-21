import { create } from 'zustand'
import {
  readExplorerStatusFilter,
  writeExplorerStatusFilter
} from '@shared/explorer-status'
import type { AppState } from './store/types'
import { markCaptionExists, unwrap } from './store/helpers'
import { applyEvent } from './store/eventHandlers'
import {
  goToActivePreviewRun,
  goToActiveStressTest,
  goToActiveValidation,
  goToActiveWeightValidation,
  loadDataset,
  loadJob,
  refreshAll,
  refreshJobs,
  closeImageEditor,
  openImageEditor,
  requestDiversify,
  requestUpscale,
  saveEditedImage,
  saveEditedImageAs
} from './store/actions'

export type {
  DatasetsMiddleTab,
  DiversifyOpenRequest,
  DiversifySource,
  UpscaleOpenRequest,
  UpscaleSource,
  ValidationFocusRequest
} from './store/types'

export const useAppStore = create<AppState>((set, get) => ({
  screen: 'datasets',
  statusMessage: 'Loading library…',
  versionLabel: '',
  settings: null,
  libraryLoading: true,
  libraryLoadProgress: null,
  datasetsListToken: 0,
  categories: [],
  datasets: [],
  selectedDatasetId: null,
  datasetDetail: null,
  selectedImage: null,
  selectedImages: [],
  datasetsMiddleTab: 'images',
  explorerStatusFilter: readExplorerStatusFilter(),
  imageScraperOpen: false,
  jobs: [],
  selectedJobId: null,
  jobDetail: null,
  queue: null,
  queueFocusJobId: null,
  logs: [],
  liveProgress: null,
  captionProgress: null,
  validationProgress: null,
  validationFocusRequest: null,
  weightProgress: null,
  weightFocusRequest: null,
  stressProgress: null,
  stressFocusRequest: null,
  previewContinuumActive: false,
  upscaleProgress: null,
  upscaleOpenRequest: null,
  upscaleSource: null,
  diversifyProgress: null,
  diversifyOpenRequest: null,
  diversifySource: null,
  imageEditor: null,
  captionReloadNonce: 0,
  error: null,
  setScreen: (screen) => set({ screen, error: null }),
  setStatus: (statusMessage) => set({ statusMessage, libraryLoadProgress: null }),
  setError: (error) => set({ error }),
  openQueueForJob: (jobId) =>
    set({ screen: 'queue', queueFocusJobId: jobId, error: null }),
  setDatasetsMiddleTab: (datasetsMiddleTab) => set({ datasetsMiddleTab }),
  setExplorerStatusFilter: (explorerStatusFilter) => {
    writeExplorerStatusFilter(explorerStatusFilter)
    set({ explorerStatusFilter })
  },
  setImageScraperOpen: (imageScraperOpen) => set({ imageScraperOpen }),
  setUpscaleSource: (upscaleSource) => set({ upscaleSource }),
  setDiversifySource: (diversifySource) => set({ diversifySource }),
  openImageEditor: (datasetId, fileName) => openImageEditor(set, datasetId, fileName),
  closeImageEditor: () => closeImageEditor(set),
  saveEditedImage: (datasetId, fileName, dataBase64) =>
    saveEditedImage(set, get, datasetId, fileName, dataBase64),
  saveEditedImageAs: (datasetId, fileName, dataBase64) =>
    saveEditedImageAs(get, datasetId, fileName, dataBase64),
  markImageCaptioned: (fileName) =>
    set({ datasetDetail: markCaptionExists(get().datasetDetail, fileName) }),
  pushLog: (entry) => set((s) => ({ logs: [...s.logs.slice(-199), entry] })),
  clearLogs: () => set({ logs: [] }),
  applyEvent: (event) => applyEvent(set, get, event),
  refreshAll: () => refreshAll(set, get),
  refreshJobs: () => refreshJobs(set),
  loadDataset: (id, opts) => loadDataset(set, get, id, opts),
  loadJob: (id) => loadJob(set, id),
  goToActiveValidation: () => goToActiveValidation(set, get),
  goToActiveWeightValidation: () => goToActiveWeightValidation(set, get),
  goToActiveStressTest: () => goToActiveStressTest(set, get),
  goToActivePreviewRun: () => goToActivePreviewRun(set, get),
  requestUpscale: (datasetId, fileName) => requestUpscale(set, get, datasetId, fileName),
  requestDiversify: (datasetId, fileName, mode) =>
    requestDiversify(set, get, datasetId, fileName, mode)
}))

export { unwrap }
