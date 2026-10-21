import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { app, shell } from 'electron'
import { appError } from '@shared/errors'
import {
  compareSemver,
  parseSetupInstallerName,
  pickNewestInstaller,
  type LocalUpdateCheck
} from '@shared/local-update'
import { loadSettings } from '../settings/store'
import { logger } from '../logging'

function resolveUpdateFolder(folder: string): string {
  const trimmed = folder.trim()
  if (!trimmed) {
    throw appError('validation', 'Update check folder is not set', {
      remediation: 'Set Settings → App updates → Release folder to your build output (e.g. …/release).'
    })
  }
  const abs = resolve(trimmed)
  if (!existsSync(abs)) {
    throw appError('validation', `Update check folder not found: ${abs}`, {
      remediation: 'Browse to the folder that contains LoraTraining Setup *.exe installers.'
    })
  }
  return abs
}

export async function checkLocalUpdate(): Promise<LocalUpdateCheck> {
  const settings = await loadSettings()
  const folder = resolveUpdateFolder(settings.updateCheckFolder)
  const currentVersion = app.getVersion()
  const names = await readdir(folder)
  const newest = pickNewestInstaller(names)
  if (!newest) {
    return {
      currentVersion,
      latestVersion: null,
      installerPath: null,
      installerFileName: null,
      updateAvailable: false
    }
  }
  const installerPath = join(folder, newest.fileName)
  return {
    currentVersion,
    latestVersion: newest.version,
    installerPath,
    installerFileName: newest.fileName,
    updateAvailable: compareSemver(newest.version, currentVersion) > 0
  }
}

/**
 * Validate `installerPath` is a Setup exe inside the configured release folder,
 * launch it detached, then quit so NSIS can replace files and the finish-page
 * “Run” checkbox can start the new build.
 */
export async function installLocalUpdate(installerPathRaw?: string): Promise<{ launched: true }> {
  const settings = await loadSettings()
  const folder = resolveUpdateFolder(settings.updateCheckFolder)
  const check = await checkLocalUpdate()
  const installerPath = resolve(installerPathRaw?.trim() || check.installerPath || '')
  if (!installerPath || !existsSync(installerPath)) {
    throw appError('validation', 'Installer not found', {
      remediation: 'Run Check for update first, or rebuild with npm run build:win.'
    })
  }
  const parsed = parseSetupInstallerName(installerPath)
  if (!parsed) {
    throw appError('validation', 'Not a LoraTraining Setup installer', {
      remediation: 'Expected a file named like “LoraTraining Setup 0.2.0.exe”.'
    })
  }
  if (dirname(installerPath).toLowerCase() !== resolve(folder).toLowerCase()) {
    throw appError('validation', 'Installer is outside the configured release folder', {
      remediation: 'Only installers inside the Update check folder can be launched.'
    })
  }

  const openErr = await shell.openPath(installerPath)
  if (openErr) {
    logger.warn({ installerPath, openErr }, 'shell.openPath failed; falling back to cmd start')
    if (process.platform === 'win32') {
      const child = spawn('cmd.exe', ['/c', 'start', '""', installerPath], {
        detached: true,
        stdio: 'ignore',
        cwd: dirname(installerPath),
        windowsHide: false
      })
      child.unref()
    } else {
      const child = spawn(installerPath, [], {
        detached: true,
        stdio: 'ignore',
        cwd: dirname(installerPath)
      })
      child.unref()
    }
  } else {
    logger.info({ installerPath }, 'update installer launched via shell.openPath')
  }

  // Give the shell a moment to hand off before we unlock the install dir.
  setTimeout(() => {
    app.quit()
  }, 400)

  return { launched: true }
}
