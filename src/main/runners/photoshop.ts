import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { BrowserWindow, dialog } from 'electron'
import { appError } from '@shared/errors'
import { getDatasetRecord } from '../datasets/store'
import { loadSettings, patchSettings } from '../settings/store'
import { assertInsideRoot } from '../security/path-guards'

async function resolvePhotoshopExecutable(): Promise<string | null> {
  const settings = await loadSettings()
  const current = settings.tools.photoshopExecutable.trim()
  if (current && existsSync(current)) {
    return current
  }

  const win = BrowserWindow.getFocusedWindow()
  const opts = {
    title: 'Locate Photoshop',
    properties: ['openFile'] as ('openFile')[],
    filters: [{ name: 'Photoshop', extensions: ['exe'] }]
  }
  const result = win
    ? await dialog.showOpenDialog(win, opts)
    : await dialog.showOpenDialog(opts)
  if (result.canceled || !result.filePaths[0]) {
    return null
  }
  const chosen = result.filePaths[0]
  if (!existsSync(chosen)) {
    throw appError('validation', 'Selected Photoshop executable was not found.')
  }
  await patchSettings({ tools: { photoshopExecutable: chosen } })
  return chosen
}

/**
 * Open a dataset image in Photoshop; prompts for exe path if unset/invalid.
 * `commitVersions` writes the newest NTFS tip into the file and drops the
 * version stack first. Otherwise Photoshop sees the pristine file body.
 */
export async function editInPhotoshop(
  datasetId: string,
  fileName: string,
  commitVersions = false
): Promise<{ opened: boolean; photoshopPath: string | null; committed: boolean }> {
  const ds = await getDatasetRecord(datasetId)
  const imagePath = assertInsideRoot(ds.folderPath, join(ds.folderPath, fileName))
  if (!existsSync(imagePath)) {
    throw appError('validation', `Image not found: ${fileName}`)
  }

  const exe = await resolvePhotoshopExecutable()
  if (!exe) {
    return { opened: false, photoshopPath: null, committed: false }
  }

  let committed = false
  if (commitVersions) {
    const { commitImageVersion } = await import('../images/imageEdit')
    const result = await commitImageVersion(imagePath)
    committed = result.committed
    if (committed) {
      const { invalidateDatasetThumb } = await import('../media/thumbs')
      const { broadcast } = await import('../events/bus')
      await invalidateDatasetThumb(datasetId, fileName, ds.folderPath)
      broadcast({ type: 'dataset-folder-changed', payload: { datasetId } })
    }
  }

  const child = spawn(exe, [imagePath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  })
  child.unref()
  return { opened: true, photoshopPath: exe, committed }
}
