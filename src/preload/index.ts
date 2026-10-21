import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IpcChannels, type AppEvent, type IpcResult, type BulkOp } from '@shared/ipc/contract'
import type { WorkflowProfile } from '@shared/workflow-profile'
import type { UpscaleConfig } from '@shared/upscale-config'
import type { DiversifyConfig, DiversifyMode } from '@shared/diversify-config'

async function invoke<T>(channel: string, payload?: unknown): Promise<IpcResult<T>> {
  return ipcRenderer.invoke(channel, payload) as Promise<IpcResult<T>>
}

const api = {
  system: {
    getVersion: () => invoke<{ version: string; electron: string; node: string }>(
      IpcChannels.system.getVersion
    ),
    chooseFolder: () =>
      invoke<{ path: string | null }>(IpcChannels.system.chooseFolder),
    chooseFile: (filters?: { name: string; extensions: string[] }[]) =>
      invoke<{ path: string | null }>(IpcChannels.system.chooseFile, { filters }),
    openPath: (path: string) =>
      invoke<{ opened: boolean }>(IpcChannels.system.openPath, { path }),
    imageScraperGuestPreloadUrl: () =>
      invoke<{ path: string; url: string }>(IpcChannels.system.imageScraperGuestPreloadUrl),
    /** Absolute path for a File from drag-and-drop (renderer). */
    pathForFile: (file: File): string => webUtils.getPathForFile(file),
    checkForUpdate: () =>
      invoke<{
        currentVersion: string
        latestVersion: string | null
        installerPath: string | null
        installerFileName: string | null
        updateAvailable: boolean
      }>(IpcChannels.system.checkForUpdate),
    installUpdate: (installerPath?: string) =>
      invoke<{ launched: true }>(IpcChannels.system.installUpdate, { installerPath })
  },
  settings: {
    get: () => invoke(IpcChannels.settings.get),
    set: (patch: unknown) => invoke(IpcChannels.settings.set, patch),
    export: () =>
      invoke<{ cancelled: boolean; path: string | null }>(IpcChannels.settings.export),
    import: () =>
      invoke<{
        cancelled: boolean
        path: string | null
        settings: unknown
      }>(IpcChannels.settings.import)
  },
  datasets: {
    list: (opts?: {
      prioritize?:
        | 'all'
        | 'none'
        | 'ready'
        | 'queued'
        | 'trained'
        | 'validated'
        | 'done'
      listToken?: number
      deferBadges?: boolean
    }) => invoke(IpcChannels.datasets.list, opts),
    get: (id: string) => invoke(IpcChannels.datasets.get, { id }),
    create: (input: {
      name: string
      folderPath: string
      categoryId: string
      trigger?: string
    }) => invoke(IpcChannels.datasets.create, input),
    update: (input: {
      id: string
      name?: string
      trigger?: string
      notes?: string
      captionGuidance?: string
      categoryId?: string
      ready?: boolean
      validated?: boolean
      coverFileName?: string | null
    }) => invoke(IpcChannels.datasets.update, input),
    markDone: (id: string) => invoke(IpcChannels.datasets.markDone, { id }),
    remove: (id: string) => invoke(IpcChannels.datasets.remove, { id }),
    deleteForever: (id: string) =>
      invoke<{ deleted: true; folderDeleted: boolean }>(IpcChannels.datasets.deleteForever, {
        id
      }),
    rescan: (id: string) => invoke(IpcChannels.datasets.rescan, { id }),
    openFolder: (id: string, relativePath?: string) =>
      invoke(IpcChannels.datasets.openFolder, { id, relativePath }),
    revealImage: (datasetId: string, fileName: string) =>
      invoke<{ revealed: true }>(IpcChannels.datasets.revealImage, { datasetId, fileName }),
    /** Reveal any path under the dataset root (e.g. `output/…` checkpoints or set previews). */
    revealRelativePath: (datasetId: string, relativePath: string) =>
      invoke<{ revealed: true }>(IpcChannels.datasets.revealRelativePath, {
        datasetId,
        relativePath
      }),
    listOutputs: (id: string) => invoke(IpcChannels.datasets.listOutputs, { id }),
    getValidationRating: (datasetId: string, setLabel: string, stem: string) =>
      invoke<{ rating: number | null; average: number | null; count: number }>(
        IpcChannels.datasets.getValidationRating,
        { datasetId, setLabel, stem }
      ),
    setValidationRating: (
      datasetId: string,
      setLabel: string,
      stem: string,
      rating: number | null
    ) =>
      invoke<{ rating: number | null; average: number | null; count: number }>(
        IpcChannels.datasets.setValidationRating,
        { datasetId, setLabel, stem, rating }
      ),
    deleteValidationPreview: (datasetId: string, setLabel: string, stem: string) =>
      invoke<{ deleted: true; average: number | null; count: number }>(
        IpcChannels.datasets.deleteValidationPreview,
        { datasetId, setLabel, stem }
      ),
    deleteImage: (datasetId: string, fileName: string, opts?: { permanent?: boolean }) =>
      invoke(IpcChannels.datasets.deleteImage, {
        datasetId,
        fileName,
        permanent: opts?.permanent === true
      }),
    convertImagesToJpg: (datasetId: string, dryRun?: boolean, fileNames?: string[]) =>
      invoke(IpcChannels.datasets.convertImagesToJpg, { datasetId, dryRun, fileNames }),
    shrinkImagesToMax: (datasetId: string, dryRun?: boolean) =>
      invoke(IpcChannels.datasets.shrinkImagesToMax, { datasetId, dryRun }),
    setCheckpointKeepInComfy: (
      datasetId: string,
      fileName: string,
      keepInComfy: boolean,
      relativePath?: string
    ) =>
      invoke<{
        keepInComfy: boolean
        deletedFromComfy: boolean
        copiedToComfy: boolean
        comfyRelativeDir: string | null
        rediscovered: boolean
      }>(IpcChannels.datasets.setCheckpointKeepInComfy, {
        datasetId,
        fileName,
        keepInComfy,
        relativePath
      }),
    moveCheckpointInComfy: (datasetId: string, fileName: string, targetRelativeDir: string) =>
      invoke<{ relativeDir: string; fullPath: string; movedFile: boolean }>(
        IpcChannels.datasets.moveCheckpointInComfy,
        { datasetId, fileName, targetRelativeDir }
      ),
    listComfyLoraSubfolders: () =>
      invoke<string[]>(IpcChannels.datasets.listComfyLoraSubfolders),
    clearOutput: (id: string) =>
      invoke<{ cleared: true; checkpointsRemoved: number; deletedFromComfy: number }>(
        IpcChannels.datasets.clearOutput,
        { id }
      ),
    createInCategory: (input: { name: string; categoryId: string }) =>
      invoke(IpcChannels.datasets.createInCategory, input),
    createFromImage: (input: {
      sourceDatasetId: string
      fileName: string
      name: string
      categoryId: string
    }) => invoke(IpcChannels.datasets.createFromImage, input),
    duplicate: (input: { sourceDatasetId: string; name: string }) =>
      invoke(IpcChannels.datasets.duplicate, input),
    importFiles: (datasetId: string, paths: string[]) =>
      invoke<{ imported: number; skipped: number }>(IpcChannels.datasets.importFiles, {
        datasetId,
        paths
      }),
    importFromUrl: (
      datasetId: string,
      url: string,
      opts?: { referrer?: string; trustAsImage?: boolean }
    ) =>
      invoke<{ fileName: string; converted: boolean }>(IpcChannels.datasets.importFromUrl, {
        datasetId,
        url,
        referrer: opts?.referrer,
        trustAsImage: opts?.trustAsImage
      }),
    transferImages: (input: {
      sourceDatasetId: string
      targetDatasetId: string
      fileNames: string[]
      mode: 'copy' | 'move'
    }) =>
      invoke<{ transferred: number; skipped: number; mode: 'copy' | 'move' }>(
        IpcChannels.datasets.transferImages,
        input
      )
  },
  categories: {
    list: () => invoke(IpcChannels.categories.list),
    create: (input: { name: string; folder?: string; folderPath?: string }) =>
      invoke(IpcChannels.categories.create, input),
    update: (input: {
      id: string
      name?: string
      sortOrder?: number
      folder?: string
      folderPath?: string
    }) => invoke(IpcChannels.categories.update, input),
    remove: (id: string) => invoke(IpcChannels.categories.remove, { id }),
    reorder: (orderedIds: string[]) =>
      invoke(IpcChannels.categories.reorder, { orderedIds })
  },
  captions: {
    get: (datasetId: string, fileName: string) =>
      invoke(IpcChannels.captions.get, { datasetId, fileName }),
    set: (datasetId: string, fileName: string, text: string) =>
      invoke(IpcChannels.captions.set, { datasetId, fileName, text }),
    clear: (datasetId: string, fileName: string) =>
      invoke(IpcChannels.captions.clear, { datasetId, fileName }),
    bulkTransform: (input: {
      datasetId: string
      op: BulkOp
      dryRun?: boolean
      createMissing?: boolean
    }) => invoke(IpcChannels.captions.bulkTransform, input),
    applyIdentityTags: (input: {
      datasetId: string
      mode: 'missing' | 'redo' | 'remove'
    }) => invoke(IpcChannels.captions.applyIdentityTags, input),
    validateReady: () => invoke(IpcChannels.captions.validateReady)
  },
  jobs: {
    list: () => invoke(IpcChannels.jobs.list),
    get: (id: string) => invoke(IpcChannels.jobs.get, { id }),
    create: (input: { name: string; datasetId: string }) =>
      invoke(IpcChannels.jobs.create, input),
    getCreateDefaults: () =>
      invoke<{ steps: number; saveEvery: number }>(IpcChannels.jobs.getCreateDefaults),
    update: (input: {
      id: string
      name?: string
      datasetId?: string
      config?: unknown
      archived?: boolean
    }) => invoke(IpcChannels.jobs.update, input),
    duplicate: (id: string) => invoke(IpcChannels.jobs.duplicate, { id }),
    remove: (id: string) => invoke(IpcChannels.jobs.remove, { id }),
    writeYaml: (id: string) => invoke(IpcChannels.jobs.writeYaml, { id }),
    exportYamlText: (id: string) => invoke(IpcChannels.jobs.exportYamlText, { id })
  },
  queue: {
    list: () => invoke(IpcChannels.queue.list),
    enqueue: (jobId: string) => invoke(IpcChannels.queue.enqueue, { jobId }),
    enqueueMany: (jobIds: string[]) => invoke(IpcChannels.queue.enqueueMany, { jobIds }),
    remove: (jobId: string) => invoke(IpcChannels.queue.remove, { jobId }),
    reorder: (orderedIds: string[]) => invoke(IpcChannels.queue.reorder, { orderedIds }),
    start: () => invoke(IpcChannels.queue.start),
    pause: () => invoke(IpcChannels.queue.pause),
    resume: () => invoke(IpcChannels.queue.resume),
    stop: () => invoke(IpcChannels.queue.stop),
    stopAfterCurrent: (enabled?: boolean) =>
      invoke(IpcChannels.queue.stopAfterCurrent, { enabled }),
    retry: (jobId: string) => invoke(IpcChannels.queue.retry, { jobId }),
    restartClear: (jobId?: string) => invoke(IpcChannels.queue.restartClear, { jobId })
  },
  tools: {
    testJoyCaption: () => invoke(IpcChannels.tools.testJoyCaption),
    testAiToolkit: () => invoke(IpcChannels.tools.testAiToolkit),
    runJoyCaption: (
      datasetId: string,
      mode: 'missing' | 'overwrite' | 'append' = 'missing',
      guidance?: string | null,
      prependTrigger?: boolean
    ) =>
      invoke<{ runId: string; queued: boolean }>(IpcChannels.tools.runJoyCaption, {
        datasetId,
        mode,
        guidance,
        prependTrigger
      }),
    cancelToolRun: (runId: string) =>
      invoke(IpcChannels.tools.cancelToolRun, { runId }),
    editInPhotoshop: (datasetId: string, fileName: string) =>
      invoke(IpcChannels.tools.editInPhotoshop, { datasetId, fileName })
  },
  imageEdit: {
    readForEdit: (datasetId: string, fileName: string) =>
      invoke<{ dataBase64: string; mime: string }>(IpcChannels.imageEdit.readForEdit, {
        datasetId,
        fileName
      }),
    save: (datasetId: string, fileName: string, dataBase64: string) =>
      invoke<{ fileName: string; preservedOriginal: boolean }>(IpcChannels.imageEdit.save, {
        datasetId,
        fileName,
        dataBase64
      }),
    saveAs: (dataBase64: string, defaultPath: string) =>
      invoke<{ path: string | null; cancelled: boolean }>(IpcChannels.imageEdit.saveAs, {
        dataBase64,
        defaultPath
      }),
    ensureLamaModel: () =>
      invoke<{ path: string; downloaded: boolean; modelUrl: string }>(
        IpcChannels.imageEdit.ensureLamaModel
      ),
    getState: (datasetId: string, fileName: string) =>
      invoke<{ versionCount: number; tipVer: number; hasVersions: boolean }>(
        IpcChannels.imageEdit.getState,
        { datasetId, fileName }
      ),
    undoLast: (datasetId: string, fileName: string) =>
      invoke<{ fileName: string; versionCount: number }>(IpcChannels.imageEdit.undoLast, {
        datasetId,
        fileName
      }),
    revertOriginal: (datasetId: string, fileName: string) =>
      invoke<{ fileName: string; reverted: boolean }>(IpcChannels.imageEdit.revertOriginal, {
        datasetId,
        fileName
      })
  },
  comfy: {
    testConnection: () => invoke(IpcChannels.comfy.testConnection),
    getLtNodesStatus: (comfyRoot?: string) =>
      invoke(IpcChannels.comfy.getLtNodesStatus, comfyRoot ? { comfyRoot } : undefined),
    installLtPackage: (opts?: { comfyRoot?: string; seedWorkflows?: boolean }) =>
      invoke(IpcChannels.comfy.installLtPackage, opts),
    seedLtWorkflows: () => invoke(IpcChannels.comfy.seedLtWorkflows),
    launch: () => invoke(IpcChannels.comfy.launch),
    listModels: (forceRefresh = false) =>
      invoke(IpcChannels.comfy.listModels, { forceRefresh }),
    saveWorkflow: (workflow: unknown, uiWorkflow?: unknown) =>
      invoke(IpcChannels.comfy.saveWorkflow, { workflow, uiWorkflow }),
    getWorkflow: () => invoke<WorkflowProfile | null>(IpcChannels.comfy.getWorkflow),
    startValidation: (datasetId: string) =>
      invoke(IpcChannels.comfy.startValidation, { datasetId }),
    cancelValidation: () => invoke(IpcChannels.comfy.cancelValidation),
    getValidationProgress: () => invoke(IpcChannels.comfy.getValidationProgress),
    listValidationSets: (datasetId: string) =>
      invoke(IpcChannels.comfy.listValidationSets, { datasetId }),
    addValidationSet: (datasetId: string) =>
      invoke(IpcChannels.comfy.addValidationSet, { datasetId }),
    updateValidationSet: (
      datasetId: string,
      setIndex: number,
      patch: {
        prompt?: string
        seed?: number
        loraWeight?: number
        styleIndex?: 0 | 1
        validationModel?: string
        existingCopyPolicy?: string
      }
    ) => invoke(IpcChannels.comfy.updateValidationSet, { datasetId, setIndex, ...patch }),
    removeValidationSet: (datasetId: string, setIndex: number) =>
      invoke(IpcChannels.comfy.removeValidationSet, { datasetId, setIndex }),
    clearValidationSetImages: (datasetId: string, setIndex: number) =>
      invoke(IpcChannels.comfy.clearValidationSetImages, { datasetId, setIndex }),
    cloneValidationSets: (input: {
      targetDatasetId: string
      sourceDatasetId: string
      mode: 'overwrite' | 'add'
    }) => invoke(IpcChannels.comfy.cloneValidationSets, input),
    startStressTest: (datasetId: string) =>
      invoke(IpcChannels.comfy.startStressTest, { datasetId }),
    cancelStressTest: () => invoke(IpcChannels.comfy.cancelStressTest),
    getStressTestProgress: () => invoke(IpcChannels.comfy.getStressTestProgress),
    listStressTestSets: (datasetId: string) =>
      invoke(IpcChannels.comfy.listStressTestSets, { datasetId }),
    addStressTestSet: (datasetId: string) =>
      invoke(IpcChannels.comfy.addStressTestSet, { datasetId }),
    updateStressTestSet: (
      datasetId: string,
      setIndex: number,
      patch: {
        prompt?: string
        seed?: number
        loraWeight?: number
        styleIndex?: 0 | 1
        models?: string[]
        checkpointFileName?: string | null
        existingCopyPolicy?: string
      }
    ) => invoke(IpcChannels.comfy.updateStressTestSet, { datasetId, setIndex, ...patch }),
    removeStressTestSet: (datasetId: string, setIndex: number) =>
      invoke(IpcChannels.comfy.removeStressTestSet, { datasetId, setIndex }),
    clearStressTestSetImages: (datasetId: string, setIndex: number) =>
      invoke(IpcChannels.comfy.clearStressTestSetImages, { datasetId, setIndex }),
    listStressPreviews: (datasetId: string, setIndex: number) =>
      invoke(IpcChannels.comfy.listStressPreviews, { datasetId, setIndex }),
    getStressCompareGrid: (datasetId: string) =>
      invoke(IpcChannels.comfy.getStressCompareGrid, { datasetId }),
    updateStressCompareLayout: (
      datasetId: string,
      patch: {
        modelOrder?: string[]
        setOrder?: number[]
        collapsedModels?: string[]
      }
    ) => invoke(IpcChannels.comfy.updateStressCompareLayout, { datasetId, ...patch }),
    startWeightValidation: (datasetId: string) =>
      invoke(IpcChannels.comfy.startWeightValidation, { datasetId }),
    cancelWeightValidation: () => invoke(IpcChannels.comfy.cancelWeightValidation),
    getWeightValidationProgress: () => invoke(IpcChannels.comfy.getWeightValidationProgress),
    listWeightSets: (datasetId: string) =>
      invoke(IpcChannels.comfy.listWeightSets, { datasetId }),
    addWeightSet: (datasetId: string) => invoke(IpcChannels.comfy.addWeightSet, { datasetId }),
    updateWeightSet: (
      datasetId: string,
      setIndex: number,
      patch: {
        prompt?: string
        seed?: number
        styleIndex?: 0 | 1
        validationModel?: string
        checkpointFileName?: string | null
        weightMin?: number
        weightMax?: number
        weightStep?: number
        existingCopyPolicy?: string
      }
    ) => invoke(IpcChannels.comfy.updateWeightSet, { datasetId, setIndex, ...patch }),
    removeWeightSet: (datasetId: string, setIndex: number) =>
      invoke(IpcChannels.comfy.removeWeightSet, { datasetId, setIndex }),
    clearWeightSetImages: (datasetId: string, setIndex: number) =>
      invoke(IpcChannels.comfy.clearWeightSetImages, { datasetId, setIndex }),
    listWeightPreviews: (datasetId: string, setIndex: number) =>
      invoke(IpcChannels.comfy.listWeightPreviews, { datasetId, setIndex }),
    getPreviewContinuumActive: () => invoke(IpcChannels.comfy.getPreviewContinuumActive),
    stopPreviewContinuum: () => invoke(IpcChannels.comfy.stopPreviewContinuum)
  },
  upscale: {
    getWorkflow: () => invoke<WorkflowProfile | null>(IpcChannels.upscale.getWorkflow),
    saveWorkflow: (workflow: unknown, uiWorkflow?: unknown) =>
      invoke(IpcChannels.upscale.saveWorkflow, { workflow, uiWorkflow }),
    getImageConfig: (datasetId: string, fileName: string) =>
      invoke<UpscaleConfig>(IpcChannels.upscale.getImageConfig, { datasetId, fileName }),
    updateImageConfig: (
      datasetId: string,
      fileName: string,
      patch: {
        prompt?: string
        seed?: number
        model?: string
        denoise?: number
        styleIndex?: 0 | 1
        maxSize?: number
      }
    ) => invoke<UpscaleConfig>(IpcChannels.upscale.updateImageConfig, { datasetId, fileName, ...patch }),
    start: (datasetId: string, fileName: string) =>
      invoke(IpcChannels.upscale.start, { datasetId, fileName }),
    startAll: (datasetId: string, fileName: string) =>
      invoke<{ started: true; queued: number }>(IpcChannels.upscale.startAll, {
        datasetId,
        fileName
      }),
    revert: (datasetId: string, fileName: string) =>
      invoke(IpcChannels.upscale.revert, { datasetId, fileName }),
    cancel: () => invoke(IpcChannels.upscale.cancel),
    getProgress: () => invoke(IpcChannels.upscale.getProgress)
  },
  diversify: {
    getWorkflow: (mode: DiversifyMode) =>
      invoke<WorkflowProfile | null>(IpcChannels.diversify.getWorkflow, { mode }),
    saveWorkflow: (mode: DiversifyMode, workflow: unknown, uiWorkflow?: unknown) =>
      invoke(IpcChannels.diversify.saveWorkflow, { mode, workflow, uiWorkflow }),
    getConfig: (mode: DiversifyMode, datasetId: string, fileName: string) =>
      invoke<DiversifyConfig>(IpcChannels.diversify.getConfig, { mode, datasetId, fileName }),
    updateConfig: (
      mode: DiversifyMode,
      datasetId: string,
      fileName: string,
      patch: {
        prompt?: string
        seed?: number
        model?: string
        count?: number
      }
    ) =>
      invoke<DiversifyConfig>(IpcChannels.diversify.updateConfig, {
        mode,
        datasetId,
        fileName,
        ...patch
      }),
    start: (mode: DiversifyMode, datasetId: string, fileName: string) =>
      invoke(IpcChannels.diversify.start, { mode, datasetId, fileName }),
    startAll: (mode: DiversifyMode, datasetId: string, fileName: string) =>
      invoke<{ started: true; queued: number }>(IpcChannels.diversify.startAll, {
        mode,
        datasetId,
        fileName
      }),
    cancel: () => invoke(IpcChannels.diversify.cancel),
    getProgress: () => invoke(IpcChannels.diversify.getProgress)
  },
  wildcards: {
    listKeys: () => invoke<string[]>(IpcChannels.wildcards.listKeys)
  },
  events: {
    subscribe: (handler: (event: AppEvent) => void): (() => void) => {
      const listener = (_: Electron.IpcRendererEvent, event: AppEvent): void => {
        handler(event)
      }
      ipcRenderer.on('app-event', listener)
      return () => ipcRenderer.removeListener('app-event', listener)
    }
  }
}

contextBridge.exposeInMainWorld('loraTraining', api)

export type LoraTrainingApi = typeof api
