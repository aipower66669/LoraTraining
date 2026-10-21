import { powerSaveBlocker } from 'electron'
import { logger } from '../logging'
import { boostWindowsProcessTree, restoreProcessPriority } from '../runners/win-process-boost'

/**
 * While AI Toolkit is training (and briefly between auto-advanced jobs), keep the
 * OS from sleeping and keep the toolkit process tree (plus this Electron process)
 * at High priority with EcoQoS disabled — Win11 otherwise throttles unfocused
 * Electron trees and dataloaders starve (slower s/it, quieter GPU fans).
 */

const BOOST_REFRESH_MS = 5_000

let wakeLockAppId: number | null = null
let wakeLockDisplayId: number | null = null
let boostTimer: ReturnType<typeof setInterval> | null = null
let trainingRootPid: number | null = null

function ensureWakeLocks(): void {
  if (wakeLockAppId == null) {
    try {
      wakeLockAppId = powerSaveBlocker.start('prevent-app-suspension')
      logger.info({ wakeLockId: wakeLockAppId }, 'training wake lock (app) started')
    } catch (err) {
      logger.warn({ err }, 'training wake lock (app) failed to start')
    }
  }
  if (wakeLockDisplayId == null) {
    try {
      wakeLockDisplayId = powerSaveBlocker.start('prevent-display-sleep')
      logger.info({ wakeLockId: wakeLockDisplayId }, 'training wake lock (display) started')
    } catch (err) {
      logger.warn({ err }, 'training wake lock (display) failed to start')
    }
  }
}

function stopWakeLock(id: number | null, label: string): void {
  if (id == null) return
  try {
    if (powerSaveBlocker.isStarted(id)) {
      powerSaveBlocker.stop(id)
    }
    logger.info({ wakeLockId: id }, `training wake lock (${label}) stopped`)
  } catch (err) {
    logger.warn({ err, wakeLockId: id }, `training wake lock (${label}) failed to stop`)
  }
}

function boostNow(rootPid: number): void {
  try {
    // Boost toolkit tree + Electron itself (Efficiency Mode often lands on the UI process).
    boostWindowsProcessTree(rootPid, [process.pid])
    logger.info({ pid: rootPid, electronPid: process.pid }, 'training process priority / EcoQoS refresh')
  } catch (err) {
    logger.warn({ err, pid: rootPid }, 'training process priority boost failed')
  }
}

export function onTrainingProcessStarted(pid: number | undefined): void {
  ensureWakeLocks()
  if (pid == null || pid <= 0) return
  trainingRootPid = pid
  boostNow(pid)
  if (boostTimer == null) {
    boostTimer = setInterval(() => {
      if (trainingRootPid != null) boostNow(trainingRootPid)
    }, BOOST_REFRESH_MS)
  }
}

/** Re-apply High priority + EcoQoS-off (e.g. after Win11 re-throttles on blur). */
export function refreshTrainingProcessBoost(): void {
  if (trainingRootPid != null) boostNow(trainingRootPid)
}

/** Release wake locks and stop priority refresh when the queue is idle. */
export function onTrainingQueueIdle(): void {
  if (boostTimer != null) {
    clearInterval(boostTimer)
    boostTimer = null
  }
  trainingRootPid = null
  try {
    restoreProcessPriority(process.pid)
  } catch {
    /* ignore */
  }
  stopWakeLock(wakeLockAppId, 'app')
  stopWakeLock(wakeLockDisplayId, 'display')
  wakeLockAppId = null
  wakeLockDisplayId = null
}
