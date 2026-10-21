import { BrowserWindow } from 'electron'
import type { AppEvent } from '@shared/ipc/contract'

const listeners = new Set<BrowserWindow>()

export function registerEventTarget(win: BrowserWindow): void {
  listeners.add(win)
  win.on('closed', () => listeners.delete(win))
}

export function broadcast(event: AppEvent): void {
  for (const win of listeners) {
    if (!win.isDestroyed()) {
      win.webContents.send('app-event', event)
    }
  }
}
