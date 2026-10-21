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

/** Open a dataset image in Photoshop; prompts for exe path if unset/invalid. */
export async function editInPhotoshop(
  datasetId: string,
  fileName: string
): Promise<{ opened: boolean; photoshopPath: string | null }> {
  const ds = await getDatasetRecord(datasetId)
  const imagePath = assertInsideRoot(ds.folderPath, join(ds.folderPath, fileName))
  if (!existsSync(imagePath)) {
    throw appError('validation', `Image not found: ${fileName}`)
  }

  const exe = await resolvePhotoshopExecutable()
  if (!exe) {
    return { opened: false, photoshopPath: null }
  }

  const child = spawn(exe, [imagePath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  })
  child.unref()
  return { opened: true, photoshopPath: exe }
}
