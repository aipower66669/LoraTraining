import { BrowserWindow, screen } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getAppDataRoot } from './settings/store'
import { logger } from './logging'

export interface WindowState {
  x: number
  y: number
  width: number
  height: number
  isMaximized: boolean
}

const DEFAULT_STATE: WindowState = {
  x: 80,
  y: 80,
  width: 1280,
  height: 840,
  isMaximized: false
}

function statePath(): string {
  return join(getAppDataRoot(), 'window-state.json')
}

function isVisibleOnAnyDisplay(state: WindowState): boolean {
  const displays = screen.getAllDisplays()
  return displays.some((d) => {
    const b = d.bounds
    const margin = 40
    return (
      state.x + state.width > b.x + margin &&
      state.y + state.height > b.y + margin &&
      state.x < b.x + b.width - margin &&
      state.y < b.y + b.height - margin
    )
  })
}

export function loadWindowState(): WindowState {
  try {
    const raw = readFileSync(statePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<WindowState>
    const state: WindowState = {
      x: Number(parsed.x) || DEFAULT_STATE.x,
      y: Number(parsed.y) || DEFAULT_STATE.y,
      width: Math.max(960, Number(parsed.width) || DEFAULT_STATE.width),
      height: Math.max(640, Number(parsed.height) || DEFAULT_STATE.height),
      isMaximized: Boolean(parsed.isMaximized)
    }
    if (!isVisibleOnAnyDisplay(state)) {
      return { ...DEFAULT_STATE }
    }
    return state
  } catch {
    return { ...DEFAULT_STATE }
  }
}

export function saveWindowState(win: BrowserWindow): void {
  try {
    const isMaximized = win.isMaximized()
    // Prefer normal bounds when maximized so restore size is correct after unmaximize.
    const bounds = isMaximized ? win.getNormalBounds() : win.getBounds()
    const state: WindowState = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized
    }
    mkdirSync(dirname(statePath()), { recursive: true })
    writeFileSync(statePath(), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  } catch (err) {
    logger.warn({ err }, 'failed to save window state')
  }
}

/** Attach close/quit persistence for a BrowserWindow created from loadWindowState(). */
export function trackWindowState(win: BrowserWindow): void {
  const persist = (): void => saveWindowState(win)
  win.on('close', persist)
}
