import { BrowserWindow, dialog } from 'electron'
import { readFile } from 'node:fs/promises'
import {
  buildSettingsExportFile,
  parseSettingsExportFile,
  type AppSettings
} from '@shared/schemas/settings'
import { appError } from '@shared/errors'
import { atomicWriteJson } from '../security/atomic-write'
import { loadSettings, patchSettings } from './store'

function focusedWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow()
}

/**
 * Save Settings-page editable fields to a user-chosen JSON file.
 * Does not include last* prefs, recents, workflows, or datasets.
 */
export async function exportSettingsToFile(): Promise<{
  cancelled: boolean
  path: string | null
}> {
  const settings = await loadSettings()
  const doc = buildSettingsExportFile(settings)
  const win = focusedWindow()
  const opts = {
    title: 'Export settings',
    defaultPath: 'lora-training-settings.json',
    filters: [{ name: 'Settings export', extensions: ['json'] }]
  }
  const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (result.canceled || !result.filePath) {
    return { cancelled: true, path: null }
  }
  await atomicWriteJson(result.filePath, doc)
  return { cancelled: false, path: result.filePath }
}

/**
 * Load a settings export file and apply it via patchSettings (as-is).
 * Preserves last* / recent fields on the target library; overwrites Settings-page fields.
 */
export async function importSettingsFromFile(): Promise<{
  cancelled: boolean
  path: string | null
  settings: AppSettings | null
}> {
  const win = focusedWindow()
  const opts = {
    title: 'Import settings',
    properties: ['openFile' as const],
    filters: [{ name: 'Settings export', extensions: ['json'] }]
  }
  const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (result.canceled || !result.filePaths[0]) {
    return { cancelled: true, path: null, settings: null }
  }
  const path = result.filePaths[0]
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    throw appError('validation', 'Could not read settings export file', {
      remediation: 'Pick a JSON file exported from Settings → Export settings…'
    })
  }
  let parsed
  try {
    parsed = parseSettingsExportFile(raw)
  } catch {
    throw appError('validation', 'Not a valid LoraTraining settings export', {
      remediation:
        'Use a file created by Export settings… (format lora-training-settings-export, version 1).'
    })
  }
  const settings = await patchSettings(parsed.settings)
  return { cancelled: false, path, settings }
}
