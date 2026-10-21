import { app, BrowserWindow, dialog, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { registerMediaProtocol, attachMediaProtocolHandler } from './media/protocol'
import { attachModelProtocolHandler } from './media/modelProtocol'
import { attachOrtProtocolHandler } from './media/ortProtocol'
import { registerIpcHandlers } from './ipc/register'
import { ensureLibraryDirs } from './settings/store'
import { registerEventTarget } from './events/bus'
import { logger } from './logging'
import { listCategories } from './categories/store'
import { hydrateQueue } from './queue/engine'
import { refreshTrainingProcessBoost } from './queue/training-session'
import { loadWindowState, trackWindowState } from './window-state'

// Before ready: this shell must not compete with AI Toolkit / Comfy for NVIDIA VRAM.
// Paint with CPU (SwiftShader). Training and Comfy stay in their own processes.
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')
app.commandLine.appendSwitch('disable-gpu-rasterization')
app.commandLine.appendSwitch('disable-accelerated-2d-canvas')
app.commandLine.appendSwitch('disable-accelerated-video-decode')
app.commandLine.appendSwitch('disable-accelerated-video-encode')
app.commandLine.appendSwitch('disable-accelerated-mjpeg-decode')
app.commandLine.appendSwitch('disable-webgl')
app.commandLine.appendSwitch('disable-webgl2')
app.commandLine.appendSwitch('disable-3d-apis')
app.commandLine.appendSwitch('use-angle', 'swiftshader')
app.commandLine.appendSwitch(
  'disable-features',
  'WebGPU,Vulkan,VaapiVideoDecoder,VaapiVideoEncoder,CanvasOopRasterization,CalculateNativeWinOcclusion'
)

// Before ready: keep Chromium from timer/occluded-window throttling while training
// (GPU work is a separate process; this stops the UI side from looking "asleep").
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-background-timer-throttling')

registerMediaProtocol()

/** Window / taskbar icon — build/ for dev, packaged exe embeds the same asset. */
function resolveAppIcon(): string | undefined {
  const candidates = [
    join(__dirname, '../../build/icon.ico'),
    join(__dirname, '../../build/icon.png'),
    join(__dirname, '../../resources/icon.png'),
    join(process.resourcesPath, 'icon.png'),
    join(app.getAppPath(), 'resources/icon.png')
  ]
  for (const path of candidates) {
    if (existsSync(path)) return path
  }
  return undefined
}

/** Undici/Electron can still surface this after aborted media fetches; don't kill the app. */
function isBenignStreamClose(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const code = 'code' in err ? String((err as { code?: unknown }).code) : ''
  return code === 'ERR_INVALID_STATE' && /ReadableStream is already closed/i.test(err.message)
}

process.on('uncaughtException', (err) => {
  if (isBenignStreamClose(err)) {
    logger.warn({ err }, 'ignored cancelled media stream close')
    return
  }
  logger.error({ err }, 'uncaughtException')
  dialog.showErrorBox(
    'Error',
    `A JavaScript error occurred in the main process\n\nUncaught Exception:\n${err.stack ?? String(err)}`
  )
})

process.on('unhandledRejection', (reason) => {
  if (isBenignStreamClose(reason)) {
    logger.warn({ err: reason }, 'ignored cancelled media stream rejection')
    return
  }
  logger.error({ err: reason }, 'unhandledRejection')
})

function createWindow(): void {
  const state = loadWindowState()
  const icon = resolveAppIcon()
  const mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0f1115',
    title: 'LoraTraining',
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      backgroundThrottling: false
    }
  })

  registerEventTarget(mainWindow)
  trackWindowState(mainWindow)

  mainWindow.webContents.setBackgroundThrottling(false)
  // Win11 re-applies EcoQoS when we lose focus — re-boost the toolkit tree immediately.
  mainWindow.on('blur', () => refreshTrainingProcessBoost())
  mainWindow.on('focus', () => refreshTrainingProcessBoost())
  mainWindow.on('show', () => refreshTrainingProcessBoost())

  mainWindow.on('ready-to-show', () => {
    if (state.isMaximized) mainWindow.maximize()
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.loratraining.app')
  }
  attachMediaProtocolHandler()
  attachModelProtocolHandler()
  attachOrtProtocolHandler()
  registerIpcHandlers()
  await ensureLibraryDirs()
  // Show the shell immediately. Library discovery (category sync, dataset.json
  // reads, output badge walks) is driven by the renderer's refreshAll — awaiting
  // it here blocked first paint, especially on cold disk after reboot.
  createWindow()
  void listCategories().catch((err) => logger.warn({ err }, 'categories warm failed'))
  // After ensureLibraryDirs → loadSettings so libraryRoot is cached before hydrate.
  void hydrateQueue().catch((err) => logger.warn({ err }, 'queue hydrate failed'))
  // Best-effort: `{file}.original` → VER_* ADS when NTFS versions are enabled.
  void import('./images/migrateOriginals')
    .then((m) => m.migrateLibraryOriginalsToAds())
    .catch((err) => logger.warn({ err }, 'image originals→ADS migration failed'))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void import('./datasets/folderWatch')
    .then(({ stopDatasetFolderWatch }) => stopDatasetFolderWatch())
    .catch(() => undefined)
  void import('./datasets/categorySync')
    .then(({ stopCategoryFolderWatches }) => stopCategoryFolderWatches())
    .catch(() => undefined)
})
