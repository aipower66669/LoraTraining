import { BrowserWindow, dialog, ipcMain, app } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { IpcChannels, type BulkOp } from '@shared/ipc/contract'
import { ok, fail } from '@shared/ipc/contract'
import { appError, type AppError } from '@shared/errors'
import { loadSettings, patchSettings } from '../settings/store'
import { exportSettingsToFile, importSettingsFromFile } from '../settings/settingsExport'
import * as datasets from '../datasets/store'
import { convertImagesToJpg } from '../datasets/convertToJpg'
import { importImageFromUrl } from '../datasets/importFromUrl'
import { shrinkImagesToMax } from '../datasets/shrinkImages'
import {
  setCheckpointKeepInComfy,
  moveCheckpointInComfy,
  listComfyLoraSubfolders
} from '../datasets/checkpointPrefs'
import * as validationRatings from '../datasets/validationRatings'
import * as categories from '../categories/store'
import * as captions from '../captions/service'
import * as identityTags from '../captions/identityTags'
import * as jobs from '../jobs/store'
import * as queue from '../queue/engine'
import * as joycaption from '../runners/joycaption'
import * as photoshop from '../runners/photoshop'
import * as imageEdit from '../images/imageEdit'
import * as lamaModel from '../images/lamaModel'
import * as validationQueue from '../comfy/validationQueue'
import * as validationSets from '../comfy/validationSets'
import * as stressQueue from '../comfy/stressQueue'
import * as stressSets from '../comfy/stressSets'
import * as stressCompare from '../comfy/stressCompare'
import * as weightQueue from '../comfy/weightQueue'
import * as weightSets from '../comfy/weightSets'
import * as previewContinuum from '../comfy/previewContinuum'
import * as upscaleQueue from '../comfy/upscaleQueue'
import * as upscaleImageConfig from '../comfy/upscaleImageConfig'
import * as diversifyQueue from '../comfy/diversifyQueue'
import * as diversifyConfig from '../comfy/diversifyConfig'
import { ComfyAdapter } from '../comfy/adapter'
import {
  loadWorkflowProfile,
  saveWorkflowProfile,
  upscaleWorkflowStore,
  contextWorkflowStore,
  expressionWorkflowStore
} from '../comfy/workflowStore'
import { logger } from '../logging'
import { listWildcardKeys } from '../wildcards/service'
import { checkLocalUpdate, fetchAppReleaseNotes, installLocalUpdate } from '../update/localUpdate'
import {
  openFolderInExplorer,
  openPathInExplorer,
  revealInExplorer
} from '../util/shell-open'

function asError(err: unknown): AppError {
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
    return err as AppError
  }
  const message = err instanceof Error ? err.message : String(err)
  logger.error({ err }, 'IPC error')
  return appError('unknown', message)
}

function handle<T>(
  channel: string,
  fn: (payload: unknown) => Promise<T>
): void {
  ipcMain.handle(channel, async (_event, payload: unknown) => {
    try {
      return ok(await fn(payload))
    } catch (err) {
      return fail(asError(err))
    }
  })
}

export function registerIpcHandlers(): void {
  handle(IpcChannels.system.getVersion, async () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node
  }))

  handle(IpcChannels.system.chooseFolder, async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return { path: result.canceled ? null : (result.filePaths[0] ?? null) }
  })

  handle(IpcChannels.system.chooseFile, async (payload) => {
    const filters = z
      .object({
        filters: z
          .array(z.object({ name: z.string(), extensions: z.array(z.string()) }))
          .optional()
      })
      .parse(payload ?? {})
    const win = BrowserWindow.getFocusedWindow()
    const opts = {
      properties: ['openFile'] as ('openFile')[],
      filters: filters.filters
    }
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    return { path: result.canceled ? null : (result.filePaths[0] ?? null) }
  })

  handle(IpcChannels.system.openPath, async (payload) => {
    const { path } = z.object({ path: z.string() }).parse(payload)
    try {
      await openPathInExplorer(path)
      return { opened: true as const }
    } catch {
      return { opened: false as const }
    }
  })
  handle(IpcChannels.system.imageScraperGuestPreloadUrl, async () => {
    const filePath = join(__dirname, '../preload/imageScraperGuest.js')
    return { path: filePath, url: pathToFileURL(filePath).href }
  })

  handle(IpcChannels.system.checkForUpdate, async () => checkLocalUpdate())
  handle(IpcChannels.system.installUpdate, async (payload) => {
    const { installerPath } = z
      .object({ installerPath: z.string().optional() })
      .parse(payload ?? {})
    return installLocalUpdate(installerPath)
  })
  handle(IpcChannels.system.getReleaseNotes, async (payload) => {
    const { version } = z.object({ version: z.string().min(1) }).parse(payload)
    return fetchAppReleaseNotes(version)
  })

  handle(IpcChannels.settings.get, async () => loadSettings())
  handle(IpcChannels.settings.set, async (payload) => patchSettings(payload))
  handle(IpcChannels.settings.export, async () => exportSettingsToFile())
  handle(IpcChannels.settings.import, async () => importSettingsFromFile())

  handle(IpcChannels.datasets.list, async (payload) => {
    const input = z
      .object({
        prioritize: z
          .enum(['all', 'none', 'ready', 'queued', 'trained', 'validated', 'done'])
          .optional(),
        listToken: z.number().int().optional(),
        deferBadges: z.boolean().optional()
      })
      .parse(payload ?? {})
    return datasets.listDatasets(input)
  })
  handle(IpcChannels.datasets.get, async (payload) => {
    const { id } = z.object({ id: z.string() }).parse(payload)
    return datasets.getDataset(id)
  })
  handle(IpcChannels.datasets.create, async (payload) => {
    const input = z
      .object({
        name: z.string(),
        folderPath: z.string(),
        categoryId: z.string(),
        trigger: z.string().optional()
      })
      .parse(payload)
    return datasets.createDataset(input)
  })
  handle(IpcChannels.datasets.update, async (payload) => {
    const input = z
      .object({
        id: z.string(),
        name: z.string().optional(),
        trigger: z.string().optional(),
        notes: z.string().optional(),
        captionGuidance: z.string().optional(),
        categoryId: z.string().optional(),
        ready: z.boolean().optional(),
        validated: z.boolean().optional(),
        coverFileName: z.string().nullable().optional()
      })
      .parse(payload)
    return datasets.updateDataset(input)
  })
  handle(IpcChannels.datasets.markDone, async (payload) => {
    const { id } = z.object({ id: z.string() }).parse(payload)
    return datasets.markDatasetDone(id)
  })
  handle(IpcChannels.datasets.remove, async (payload) => {
    const { id } = z.object({ id: z.string() }).parse(payload)
    return datasets.removeDataset(id)
  })
  handle(IpcChannels.datasets.deleteForever, async (payload) => {
    const { id } = z.object({ id: z.string() }).parse(payload)
    return datasets.deleteDatasetForever(id)
  })
  handle(IpcChannels.datasets.rescan, async (payload) => {
    const { id } = z.object({ id: z.string() }).parse(payload)
    return datasets.rescanDataset(id)
  })
  handle(IpcChannels.datasets.openFolder, async (payload) => {
    const { id, relativePath } = z
      .object({ id: z.string(), relativePath: z.string().min(1).optional() })
      .parse(payload)
    const target = relativePath
      ? await datasets.resolveDatasetRelativePath(id, relativePath)
      : (await datasets.getDatasetRecord(id)).folderPath
    try {
      await openFolderInExplorer(target)
      return { opened: true as const }
    } catch {
      return { opened: false as const }
    }
  })
  handle(IpcChannels.datasets.revealImage, async (payload) => {
    const { datasetId, fileName } = z
      .object({ datasetId: z.string(), fileName: z.string() })
      .parse(payload)
    const full = await datasets.resolveDatasetImagePath(datasetId, fileName)
    await revealInExplorer(full)
    return { revealed: true as const }
  })
  handle(IpcChannels.datasets.revealRelativePath, async (payload) => {
    const { datasetId, relativePath } = z
      .object({ datasetId: z.string(), relativePath: z.string().min(1) })
      .parse(payload)
    const full = await datasets.resolveDatasetRelativePath(datasetId, relativePath)
    await revealInExplorer(full)
    return { revealed: true as const }
  })
  handle(IpcChannels.datasets.listOutputs, async (payload) => {
    const { id } = z.object({ id: z.string() }).parse(payload)
    return datasets.listDatasetOutputs(id)
  })
  handle(IpcChannels.datasets.getValidationRating, async (payload) => {
    const { datasetId, setLabel, stem } = z
      .object({
        datasetId: z.string(),
        setLabel: z.string(),
        stem: z.string()
      })
      .parse(payload)
    const ds = await datasets.getDatasetRecord(datasetId)
    return validationRatings.getValidationRatingForFolder({
      datasetFolder: ds.folderPath,
      setLabel,
      stem
    })
  })
  handle(IpcChannels.datasets.setValidationRating, async (payload) => {
    const { datasetId, setLabel, stem, rating } = z
      .object({
        datasetId: z.string(),
        setLabel: z.string(),
        stem: z.string(),
        rating: z.number().int().min(0).max(5).nullable()
      })
      .parse(payload)
    const ds = await datasets.getDatasetRecord(datasetId)
    return validationRatings.setValidationRatingForFolder({
      datasetFolder: ds.folderPath,
      setLabel,
      stem,
      rating
    })
  })
  handle(IpcChannels.datasets.deleteValidationPreview, async (payload) => {
    const { datasetId, setLabel, stem } = z
      .object({
        datasetId: z.string(),
        setLabel: z.string(),
        stem: z.string()
      })
      .parse(payload)
    return datasets.deleteValidationPreview({ datasetId, setLabel, stem })
  })
  handle(IpcChannels.datasets.deleteImage, async (payload) => {
    const { datasetId, fileName, permanent } = z
      .object({
        datasetId: z.string(),
        fileName: z.string(),
        permanent: z.boolean().optional()
      })
      .parse(payload)
    return datasets.deleteDatasetImage(datasetId, fileName, { permanent })
  })
  handle(IpcChannels.datasets.convertImagesToJpg, async (payload) => {
    const input = z
      .object({
        datasetId: z.string(),
        dryRun: z.boolean().optional(),
        fileNames: z.array(z.string()).optional()
      })
      .parse(payload)
    return convertImagesToJpg(input)
  })
  handle(IpcChannels.datasets.shrinkImagesToMax, async (payload) => {
    const input = z
      .object({
        datasetId: z.string(),
        dryRun: z.boolean().optional()
      })
      .parse(payload)
    return shrinkImagesToMax(input)
  })
  handle(IpcChannels.datasets.setCheckpointKeepInComfy, async (payload) => {
    const input = z
      .object({
        datasetId: z.string(),
        fileName: z.string(),
        keepInComfy: z.boolean(),
        relativePath: z.string().optional()
      })
      .parse(payload)
    const ds = await datasets.getDatasetRecord(input.datasetId)
    const result = await setCheckpointKeepInComfy({
      datasetId: input.datasetId,
      datasetFolder: ds.folderPath,
      fileName: input.fileName,
      keepInComfy: input.keepInComfy,
      relativePath: input.relativePath,
      datasetSubfolder: undefined
    })
    await datasets.syncDatasetValidatedFlag(input.datasetId).catch(() => undefined)
    return result
  })

  handle(IpcChannels.datasets.moveCheckpointInComfy, async (payload) => {
    const input = z
      .object({
        datasetId: z.string(),
        fileName: z.string(),
        targetRelativeDir: z.string()
      })
      .parse(payload)
    const ds = await datasets.getDatasetRecord(input.datasetId)
    return moveCheckpointInComfy({
      datasetFolder: ds.folderPath,
      fileName: input.fileName,
      targetRelativeDir: input.targetRelativeDir,
      datasetSubfolder: undefined
    })
  })

  handle(IpcChannels.datasets.listComfyLoraSubfolders, async () => {
    return listComfyLoraSubfolders()
  })

  handle(IpcChannels.datasets.clearOutput, async (payload) => {
    const { id } = z.object({ id: z.string() }).parse(payload)
    return datasets.clearDatasetOutput(id)
  })

  handle(IpcChannels.datasets.createInCategory, async (payload) => {
    const input = z.object({ name: z.string(), categoryId: z.string() }).parse(payload)
    return datasets.createDatasetInCategory(input)
  })

  handle(IpcChannels.datasets.createFromImage, async (payload) => {
    const input = z
      .object({
        sourceDatasetId: z.string(),
        fileName: z.string(),
        name: z.string(),
        categoryId: z.string()
      })
      .parse(payload)
    return datasets.createDatasetFromImage(input)
  })

  handle(IpcChannels.datasets.duplicate, async (payload) => {
    const input = z.object({ sourceDatasetId: z.string(), name: z.string() }).parse(payload)
    return datasets.duplicateDataset(input)
  })

  handle(IpcChannels.datasets.importFiles, async (payload) => {
    const input = z
      .object({ datasetId: z.string(), paths: z.array(z.string()) })
      .parse(payload)
    return datasets.importDatasetFiles(input)
  })
  handle(IpcChannels.datasets.importFromUrl, async (payload) => {
    const input = z
      .object({
        datasetId: z.string(),
        url: z.string().url(),
        referrer: z.string().optional(),
        trustAsImage: z.boolean().optional()
      })
      .parse(payload)
    return importImageFromUrl(input)
  })
  handle(IpcChannels.datasets.transferImages, async (payload) => {
    const input = z
      .object({
        sourceDatasetId: z.string(),
        targetDatasetId: z.string(),
        fileNames: z.array(z.string()).min(1),
        mode: z.enum(['copy', 'move'])
      })
      .parse(payload)
    return datasets.transferDatasetImages(input)
  })

  handle(IpcChannels.categories.list, async () => {
    categories.invalidateCategoryCache()
    return categories.listCategories()
  })
  handle(IpcChannels.categories.create, async (payload) => {
    const input = z
      .object({
        name: z.string(),
        folder: z.string().optional(),
        folderPath: z.string().optional()
      })
      .parse(payload)
    const created = await categories.createCategory(input)
    const { syncCategoryFolderDatasets, watchCategoryFolders } = await import(
      '../datasets/categorySync'
    )
    await syncCategoryFolderDatasets(created.id)
    void watchCategoryFolders()
    const { broadcast } = await import('../events/bus')
    // Always notify — even when sync finds 0 datasets — so the library refreshes.
    broadcast({
      type: 'category-datasets-changed',
      payload: { categoryId: created.id }
    })
    return created
  })
  handle(IpcChannels.categories.update, async (payload) => {
    const input = z
      .object({
        id: z.string(),
        name: z.string().optional(),
        sortOrder: z.number().optional(),
        folder: z.string().optional(),
        folderPath: z.string().optional()
      })
      .parse(payload)
    const updated = await categories.updateCategory(input)
    if (input.folder !== undefined || input.folderPath !== undefined) {
      const { syncCategoryFolderDatasets, watchCategoryFolders } = await import(
        '../datasets/categorySync'
      )
      await syncCategoryFolderDatasets(updated.id)
      void watchCategoryFolders()
    }
    const { broadcast } = await import('../events/bus')
    // Name/folder edits must refresh the library even when no datasets were upserted.
    broadcast({
      type: 'category-datasets-changed',
      payload: { categoryId: updated.id }
    })
    return updated
  })
  handle(IpcChannels.categories.remove, async (payload) => {
    const { id } = z.object({ id: z.string() }).parse(payload)
    return datasets.removeCategoryAndReassign(id)
  })
  handle(IpcChannels.categories.reorder, async (payload) => {
    const { orderedIds } = z.object({ orderedIds: z.array(z.string()) }).parse(payload)
    return categories.reorderCategories(orderedIds)
  })

  handle(IpcChannels.captions.get, async (payload) => {
    const { datasetId, fileName } = z
      .object({ datasetId: z.string(), fileName: z.string() })
      .parse(payload)
    return captions.getCaption(datasetId, fileName)
  })
  handle(IpcChannels.captions.set, async (payload) => {
    const { datasetId, fileName, text } = z
      .object({ datasetId: z.string(), fileName: z.string(), text: z.string() })
      .parse(payload)
    return captions.setCaption(datasetId, fileName, text)
  })
  handle(IpcChannels.captions.clear, async (payload) => {
    const { datasetId, fileName } = z
      .object({ datasetId: z.string(), fileName: z.string() })
      .parse(payload)
    return captions.clearCaption(datasetId, fileName)
  })
  handle(IpcChannels.captions.bulkTransform, async (payload) => {
    const input = z
      .object({
        datasetId: z.string(),
        op: z.custom<BulkOp>(),
        dryRun: z.boolean().optional(),
        createMissing: z.boolean().optional()
      })
      .parse(payload)
    return captions.bulkTransform(input)
  })
  handle(IpcChannels.captions.applyIdentityTags, async (payload) => {
    const input = z
      .object({
        datasetId: z.string(),
        mode: z.enum(['missing', 'redo', 'remove'])
      })
      .parse(payload)
    return identityTags.applyIdentityTags(input)
  })
  handle(IpcChannels.captions.validateReady, async () => captions.validateReadyCaptions())

  handle(IpcChannels.jobs.list, async () => jobs.listJobs())
  handle(IpcChannels.jobs.get, async (payload) => {
    const { id } = z.object({ id: z.string() }).parse(payload)
    return jobs.getJob(id)
  })
  handle(IpcChannels.jobs.create, async (payload) => {
    const input = z.object({ name: z.string(), datasetId: z.string() }).parse(payload)
    return jobs.createJob(input)
  })
  handle(IpcChannels.jobs.getCreateDefaults, async () => jobs.getCreateJobDefaults())
  handle(IpcChannels.jobs.update, async (payload) => {
    const input = z
      .object({
        id: z.string(),
        name: z.string().optional(),
        datasetId: z.string().optional(),
        config: z.unknown().optional(),
        archived: z.boolean().optional()
      })
      .parse(payload)
    const detail = await jobs.updateJob(input)
    await queue.refreshQueueAfterJobChange(input.id)
    return detail
  })
  handle(IpcChannels.jobs.duplicate, async (payload) => {
    const { id } = z.object({ id: z.string() }).parse(payload)
    return jobs.duplicateJob(id)
  })
  handle(IpcChannels.jobs.remove, async (payload) => {
    const { id } = z.object({ id: z.string() }).parse(payload)
    return jobs.removeJob(id)
  })
  handle(IpcChannels.jobs.writeYaml, async (payload) => {
    const { id } = z.object({ id: z.string() }).parse(payload)
    return jobs.writeYamlForJob(id)
  })
  handle(IpcChannels.jobs.exportYamlText, async (payload) => {
    const { id } = z.object({ id: z.string() }).parse(payload)
    return jobs.exportYamlText(id)
  })

  handle(IpcChannels.queue.list, async () => queue.listQueue())
  handle(IpcChannels.queue.enqueue, async (payload) => {
    const { jobId } = z.object({ jobId: z.string() }).parse(payload)
    return queue.enqueue(jobId)
  })
  handle(IpcChannels.queue.enqueueMany, async (payload) => {
    const { jobIds } = z.object({ jobIds: z.array(z.string()) }).parse(payload)
    return queue.enqueueMany(jobIds)
  })
  handle(IpcChannels.queue.remove, async (payload) => {
    const { jobId } = z.object({ jobId: z.string() }).parse(payload)
    return queue.removeFromQueue(jobId)
  })
  handle(IpcChannels.queue.reorder, async (payload) => {
    const { orderedIds } = z.object({ orderedIds: z.array(z.string()) }).parse(payload)
    return queue.reorderQueue(orderedIds)
  })
  handle(IpcChannels.queue.start, async () => queue.startQueue())
  handle(IpcChannels.queue.pause, async () => queue.pauseQueue())
  handle(IpcChannels.queue.resume, async () => queue.resumeQueue())
  handle(IpcChannels.queue.stop, async () => queue.stopQueue())
  handle(IpcChannels.queue.stopAfterCurrent, async (payload) => {
    const input = z
      .object({ enabled: z.boolean().optional() })
      .optional()
      .parse(payload ?? undefined)
    return queue.setStopAfterCurrent(input?.enabled)
  })
  handle(IpcChannels.queue.retry, async (payload) => {
    const { jobId } = z.object({ jobId: z.string() }).parse(payload)
    return queue.retryJob(jobId)
  })
  handle(IpcChannels.queue.restartClear, async (payload) => {
    const { jobId } = z.object({ jobId: z.string().optional() }).parse(payload ?? {})
    return queue.restartClear(jobId)
  })

  handle(IpcChannels.tools.testJoyCaption, async () => joycaption.testJoyCaption())
  handle(IpcChannels.tools.testAiToolkit, async () => joycaption.testAiToolkit())
  handle(IpcChannels.tools.runJoyCaption, async (payload) => {
    const { datasetId, mode, guidance, prependTrigger } = z
      .object({
        datasetId: z.string(),
        mode: z.enum(['missing', 'overwrite', 'append']).default('missing'),
        guidance: z.string().nullable().optional(),
        prependTrigger: z.boolean().optional()
      })
      .parse(payload)
    return joycaption.runJoyCaption(datasetId, mode, { guidance, prependTrigger })
  })
  handle(IpcChannels.tools.cancelToolRun, async (payload) => {
    const { runId } = z.object({ runId: z.string() }).parse(payload)
    return joycaption.cancelToolRun(runId)
  })
  handle(IpcChannels.tools.editInPhotoshop, async (payload) => {
    const { datasetId, fileName, commitVersions } = z
      .object({
        datasetId: z.string(),
        fileName: z.string(),
        commitVersions: z.boolean().optional()
      })
      .parse(payload)
    return photoshop.editInPhotoshop(datasetId, fileName, commitVersions === true)
  })

  handle(IpcChannels.imageEdit.readForEdit, async (payload) => {
    const { datasetId, fileName } = z
      .object({ datasetId: z.string(), fileName: z.string() })
      .parse(payload)
    return imageEdit.readImageForEdit(datasetId, fileName)
  })
  handle(IpcChannels.imageEdit.save, async (payload) => {
    const { datasetId, fileName, dataBase64 } = z
      .object({
        datasetId: z.string(),
        fileName: z.string(),
        dataBase64: z.string().min(1)
      })
      .parse(payload)
    return imageEdit.saveEditedImage(datasetId, fileName, dataBase64)
  })
  handle(IpcChannels.imageEdit.saveAs, async (payload) => {
    const { dataBase64, defaultPath } = z
      .object({ dataBase64: z.string().min(1), defaultPath: z.string().min(1) })
      .parse(payload)
    return imageEdit.saveEditedImageAs(dataBase64, defaultPath)
  })
  handle(IpcChannels.imageEdit.ensureLamaModel, async () => {
    const result = await lamaModel.ensureLamaModel()
    return {
      ...result,
      modelUrl: `loratraining-model://local/${lamaModel.LAMA_MODEL_FILENAME}`
    }
  })
  handle(IpcChannels.imageEdit.getState, async (payload) => {
    const { datasetId, fileName } = z
      .object({ datasetId: z.string(), fileName: z.string() })
      .parse(payload)
    return imageEdit.getImageEditState(datasetId, fileName)
  })
  handle(IpcChannels.imageEdit.undoLast, async (payload) => {
    const { datasetId, fileName } = z
      .object({ datasetId: z.string(), fileName: z.string() })
      .parse(payload)
    return imageEdit.undoLastImageVersion(datasetId, fileName)
  })
  handle(IpcChannels.imageEdit.revertOriginal, async (payload) => {
    const { datasetId, fileName } = z
      .object({ datasetId: z.string(), fileName: z.string() })
      .parse(payload)
    return imageEdit.revertImageOriginal(datasetId, fileName)
  })

  handle(IpcChannels.comfy.testConnection, async () => {
    const settings = await loadSettings()
    return new ComfyAdapter(settings.comfy).testConnection()
  })
  handle(IpcChannels.comfy.getLtNodesStatus, async (payload) => {
    const input = z.object({ comfyRoot: z.string().optional() }).optional().parse(payload ?? undefined)
    const { getLtComfyNodesStatus } = await import('../comfy/bundledLtNodes')
    return getLtComfyNodesStatus(input?.comfyRoot)
  })
  handle(IpcChannels.comfy.installLtPackage, async (payload) => {
    const input = z
      .object({
        comfyRoot: z.string().optional(),
        seedWorkflows: z.boolean().optional()
      })
      .optional()
      .parse(payload ?? undefined)
    const { installLtComfyPackage } = await import('../comfy/bundledLtNodes')
    return installLtComfyPackage({
      comfyRoot: input?.comfyRoot,
      seedWorkflows: input?.seedWorkflows
    })
  })
  handle(IpcChannels.comfy.seedLtWorkflows, async () => {
    const { seedLtLibraryWorkflows } = await import('../comfy/bundledLtNodes')
    return seedLtLibraryWorkflows()
  })
  handle(IpcChannels.comfy.launch, async () => {
    const { launchComfyUi } = await import('../comfy/launchComfy')
    return launchComfyUi()
  })
  handle(IpcChannels.comfy.listModels, async (payload) => {
    const input = z
      .object({ forceRefresh: z.boolean().optional() })
      .optional()
      .parse(payload ?? undefined)
    const { listComfyCheckpointModels } = await import('../comfy/modelList')
    return listComfyCheckpointModels(input?.forceRefresh === true)
  })
  handle(IpcChannels.comfy.saveWorkflow, async (payload) => {
    const { workflow, uiWorkflow } = z
      .object({
        workflow: z.unknown(),
        uiWorkflow: z.unknown().optional()
      })
      .parse(payload)
    return saveWorkflowProfile({ workflow, uiWorkflow })
  })
  handle(IpcChannels.comfy.getWorkflow, async () => loadWorkflowProfile())
  handle(IpcChannels.comfy.startValidation, async (payload) => {
    const { datasetId } = z.object({ datasetId: z.string() }).parse(payload)
    return validationQueue.startValidation({ datasetId })
  })
  handle(IpcChannels.comfy.cancelValidation, async () => validationQueue.cancelValidation())
  handle(IpcChannels.comfy.getValidationProgress, async () =>
    validationQueue.getValidationProgress()
  )
  handle(IpcChannels.comfy.listValidationSets, async (payload) => {
    const { datasetId } = z.object({ datasetId: z.string() }).parse(payload)
    return validationSets.listValidationSets(datasetId)
  })
  handle(IpcChannels.comfy.addValidationSet, async (payload) => {
    const { datasetId } = z.object({ datasetId: z.string() }).parse(payload)
    return validationSets.addValidationSet(datasetId)
  })
  handle(IpcChannels.comfy.updateValidationSet, async (payload) => {
    const input = z
      .object({
        datasetId: z.string(),
        setIndex: z.number().int().nonnegative(),
        prompt: z.string().optional(),
        seed: z.number().optional(),
        loraWeight: z.number().optional(),
        styleIndex: z.union([z.literal(0), z.literal(1)]).optional(),
        validationModel: z.string().optional(),
        existingCopyPolicy: z
          .enum(['reuse_if_identical_error_if_different', 'overwrite_if_different'])
          .optional()
      })
      .parse(payload)
    const { datasetId, setIndex, ...patch } = input
    return validationSets.updateValidationSet(datasetId, setIndex, patch)
  })
  handle(IpcChannels.comfy.removeValidationSet, async (payload) => {
    const { datasetId, setIndex } = z
      .object({ datasetId: z.string(), setIndex: z.number().int().nonnegative() })
      .parse(payload)
    return validationSets.removeValidationSet(datasetId, setIndex)
  })
  handle(IpcChannels.comfy.clearValidationSetImages, async (payload) => {
    const { datasetId, setIndex } = z
      .object({ datasetId: z.string(), setIndex: z.number().int().nonnegative() })
      .parse(payload)
    return validationSets.clearValidationSetImages(datasetId, setIndex)
  })
  handle(IpcChannels.comfy.cloneValidationSets, async (payload) => {
    const input = z
      .object({
        targetDatasetId: z.string(),
        sourceDatasetId: z.string(),
        mode: z.enum(['overwrite', 'add'])
      })
      .parse(payload)
    return validationSets.cloneValidationSets(input)
  })

  handle(IpcChannels.comfy.startStressTest, async (payload) => {
    const { datasetId } = z.object({ datasetId: z.string() }).parse(payload)
    return stressQueue.startStressTest({ datasetId })
  })
  handle(IpcChannels.comfy.cancelStressTest, async () => stressQueue.cancelStressTest())
  handle(IpcChannels.comfy.getStressTestProgress, async () => stressQueue.getStressTestProgress())
  handle(IpcChannels.comfy.listStressTestSets, async (payload) => {
    const { datasetId } = z.object({ datasetId: z.string() }).parse(payload)
    return stressSets.listStressTestSets(datasetId)
  })
  handle(IpcChannels.comfy.addStressTestSet, async (payload) => {
    const { datasetId } = z.object({ datasetId: z.string() }).parse(payload)
    return stressSets.addStressTestSet(datasetId)
  })
  handle(IpcChannels.comfy.updateStressTestSet, async (payload) => {
    const input = z
      .object({
        datasetId: z.string(),
        setIndex: z.number().int().nonnegative(),
        prompt: z.string().optional(),
        seed: z.number().optional(),
        loraWeight: z.number().optional(),
        styleIndex: z.union([z.literal(0), z.literal(1)]).optional(),
        models: z.array(z.string()).optional(),
        checkpointFileName: z.string().nullable().optional(),
        existingCopyPolicy: z
          .enum(['reuse_if_identical_error_if_different', 'overwrite_if_different'])
          .optional()
      })
      .parse(payload)
    const { datasetId, setIndex, ...patch } = input
    return stressSets.updateStressTestSet(datasetId, setIndex, patch)
  })
  handle(IpcChannels.comfy.removeStressTestSet, async (payload) => {
    const { datasetId, setIndex } = z
      .object({ datasetId: z.string(), setIndex: z.number().int().nonnegative() })
      .parse(payload)
    return stressSets.removeStressTestSet(datasetId, setIndex)
  })
  handle(IpcChannels.comfy.clearStressTestSetImages, async (payload) => {
    const { datasetId, setIndex } = z
      .object({ datasetId: z.string(), setIndex: z.number().int().nonnegative() })
      .parse(payload)
    return stressSets.clearStressTestSetImages(datasetId, setIndex)
  })
  handle(IpcChannels.comfy.listStressPreviews, async (payload) => {
    const { datasetId, setIndex } = z
      .object({ datasetId: z.string(), setIndex: z.number().int().nonnegative() })
      .parse(payload)
    const ds = await datasets.getDatasetRecord(datasetId)
    return stressSets.listStressPreviews(ds.folderPath, setIndex)
  })
  handle(IpcChannels.comfy.getStressCompareGrid, async (payload) => {
    const { datasetId } = z.object({ datasetId: z.string() }).parse(payload)
    return stressCompare.getStressCompareGrid(datasetId)
  })
  handle(IpcChannels.comfy.updateStressCompareLayout, async (payload) => {
    const input = z
      .object({
        datasetId: z.string(),
        modelOrder: z.array(z.string()).optional(),
        setOrder: z.array(z.number().int().nonnegative()).optional(),
        collapsedModels: z.array(z.string()).optional()
      })
      .parse(payload)
    const { datasetId, ...patch } = input
    return stressCompare.updateStressCompareLayout(datasetId, patch)
  })

  handle(IpcChannels.comfy.startWeightValidation, async (payload) => {
    const { datasetId } = z.object({ datasetId: z.string() }).parse(payload)
    return weightQueue.startWeightValidation({ datasetId })
  })
  handle(IpcChannels.comfy.cancelWeightValidation, async () =>
    weightQueue.cancelWeightValidation()
  )
  handle(IpcChannels.comfy.getWeightValidationProgress, async () =>
    weightQueue.getWeightValidationProgress()
  )
  handle(IpcChannels.comfy.listWeightSets, async (payload) => {
    const { datasetId } = z.object({ datasetId: z.string() }).parse(payload)
    return weightSets.listWeightSets(datasetId)
  })
  handle(IpcChannels.comfy.addWeightSet, async (payload) => {
    const { datasetId } = z.object({ datasetId: z.string() }).parse(payload)
    return weightSets.addWeightSet(datasetId)
  })
  handle(IpcChannels.comfy.updateWeightSet, async (payload) => {
    const input = z
      .object({
        datasetId: z.string(),
        setIndex: z.number().int().nonnegative(),
        prompt: z.string().optional(),
        seed: z.number().optional(),
        styleIndex: z.union([z.literal(0), z.literal(1)]).optional(),
        validationModel: z.string().optional(),
        checkpointFileName: z.string().nullable().optional(),
        weightMin: z.number().optional(),
        weightMax: z.number().optional(),
        weightStep: z.number().optional(),
        existingCopyPolicy: z
          .enum(['reuse_if_identical_error_if_different', 'overwrite_if_different'])
          .optional()
      })
      .parse(payload)
    const { datasetId, setIndex, ...patch } = input
    return weightSets.updateWeightSet(datasetId, setIndex, patch)
  })
  handle(IpcChannels.comfy.removeWeightSet, async (payload) => {
    const { datasetId, setIndex } = z
      .object({ datasetId: z.string(), setIndex: z.number().int().nonnegative() })
      .parse(payload)
    return weightSets.removeWeightSet(datasetId, setIndex)
  })
  handle(IpcChannels.comfy.clearWeightSetImages, async (payload) => {
    const { datasetId, setIndex } = z
      .object({ datasetId: z.string(), setIndex: z.number().int().nonnegative() })
      .parse(payload)
    return weightSets.clearWeightSetImages(datasetId, setIndex)
  })
  handle(IpcChannels.comfy.listWeightPreviews, async (payload) => {
    const { datasetId, setIndex } = z
      .object({ datasetId: z.string(), setIndex: z.number().int().nonnegative() })
      .parse(payload)
    const ds = await datasets.getDatasetRecord(datasetId)
    return weightSets.listWeightPreviews(ds.folderPath, setIndex)
  })
  handle(IpcChannels.comfy.getPreviewContinuumActive, async () => ({
    active: previewContinuum.isPreviewContinuumActive()
  }))
  handle(IpcChannels.comfy.stopPreviewContinuum, async () => {
    previewContinuum.stopPreviewContinuum()
    return { stopped: true as const }
  })

  handle(IpcChannels.upscale.getWorkflow, async () => upscaleWorkflowStore.loadProfile())
  handle(IpcChannels.upscale.saveWorkflow, async (payload) => {
    const { workflow, uiWorkflow } = z
      .object({
        workflow: z.unknown(),
        uiWorkflow: z.unknown().optional()
      })
      .parse(payload)
    return upscaleWorkflowStore.saveProfile({ workflow, uiWorkflow })
  })
  handle(IpcChannels.upscale.getImageConfig, async (payload) => {
    const { datasetId, fileName } = z
      .object({ datasetId: z.string(), fileName: z.string() })
      .parse(payload)
    return upscaleImageConfig.getUpscaleImageConfig(datasetId, fileName)
  })
  handle(IpcChannels.upscale.updateImageConfig, async (payload) => {
    const input = z
      .object({
        datasetId: z.string(),
        fileName: z.string(),
        prompt: z.string().optional(),
        seed: z.number().optional(),
        model: z.string().optional(),
        denoise: z.number().min(0).max(1).optional(),
        styleIndex: z.union([z.literal(0), z.literal(1)]).optional(),
        maxSize: z.number().int().min(64).max(8192).optional()
      })
      .parse(payload)
    const { datasetId, fileName, ...patch } = input
    return upscaleImageConfig.updateUpscaleImageConfig(datasetId, fileName, patch)
  })
  handle(IpcChannels.upscale.start, async (payload) => {
    const { datasetId, fileName } = z
      .object({ datasetId: z.string(), fileName: z.string() })
      .parse(payload)
    return upscaleQueue.startUpscale({ datasetId, fileName })
  })
  handle(IpcChannels.upscale.startAll, async (payload) => {
    const { datasetId, fileName } = z
      .object({ datasetId: z.string(), fileName: z.string() })
      .parse(payload)
    return upscaleQueue.startUpscaleAll({ datasetId, fileName })
  })
  handle(IpcChannels.upscale.revert, async (payload) => {
    const { datasetId, fileName } = z
      .object({ datasetId: z.string(), fileName: z.string() })
      .parse(payload)
    return upscaleQueue.revertUpscaleImage({ datasetId, fileName })
  })
  handle(IpcChannels.upscale.cancel, async () => upscaleQueue.cancelUpscale())
  handle(IpcChannels.upscale.getProgress, async () => upscaleQueue.getUpscaleProgress())

  const diversifyMode = z.enum(['context', 'expression'])
  handle(IpcChannels.diversify.getWorkflow, async (payload) => {
    const { mode } = z.object({ mode: diversifyMode }).parse(payload)
    return (mode === 'context' ? contextWorkflowStore : expressionWorkflowStore).loadProfile()
  })
  handle(IpcChannels.diversify.saveWorkflow, async (payload) => {
    const { mode, workflow, uiWorkflow } = z
      .object({
        mode: diversifyMode,
        workflow: z.unknown(),
        uiWorkflow: z.unknown().optional()
      })
      .parse(payload)
    const store = mode === 'context' ? contextWorkflowStore : expressionWorkflowStore
    return store.saveProfile({ workflow, uiWorkflow })
  })
  handle(IpcChannels.diversify.getConfig, async (payload) => {
    const { mode, datasetId, fileName } = z
      .object({ mode: diversifyMode, datasetId: z.string(), fileName: z.string() })
      .parse(payload)
    return diversifyConfig.getDiversifyConfig(mode, datasetId, fileName)
  })
  handle(IpcChannels.diversify.updateConfig, async (payload) => {
    const input = z
      .object({
        mode: diversifyMode,
        datasetId: z.string(),
        fileName: z.string(),
        prompt: z.string().optional(),
        seed: z.number().optional(),
        model: z.string().optional(),
        count: z.number().int().min(1).max(64).optional()
      })
      .parse(payload)
    const { mode, datasetId, fileName, ...patch } = input
    return diversifyConfig.updateDiversifyConfig(mode, datasetId, fileName, patch)
  })
  handle(IpcChannels.diversify.start, async (payload) => {
    const { datasetId, fileName, mode } = z
      .object({ datasetId: z.string(), fileName: z.string(), mode: diversifyMode })
      .parse(payload)
    return diversifyQueue.startDiversify({ datasetId, fileName, mode })
  })
  handle(IpcChannels.diversify.startAll, async (payload) => {
    const { datasetId, fileName, mode } = z
      .object({ datasetId: z.string(), fileName: z.string(), mode: diversifyMode })
      .parse(payload)
    return diversifyQueue.startDiversifyAll({ datasetId, fileName, mode })
  })
  handle(IpcChannels.diversify.cancel, async () => diversifyQueue.cancelDiversify())
  handle(IpcChannels.diversify.getProgress, async () => diversifyQueue.getDiversifyProgress())

  handle(IpcChannels.wildcards.listKeys, async () => listWildcardKeys())
}
