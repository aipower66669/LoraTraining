import { shell } from 'electron'
import { stat } from 'node:fs/promises'
import { logger } from '../logging'

/**
 * Custom file explorer (Windows protocol handler). Paths must be URI-encoded
 * in the query string — see mfe://reveal and mfe://open.
 */

export function mfeRevealUrl(absolutePath: string): string {
  return `mfe://reveal?path=${encodeURIComponent(absolutePath)}`
}

export function mfeOpenUrl(absolutePath: string): string {
  return `mfe://open?path=${encodeURIComponent(absolutePath)}`
}

async function openMfeUrl(url: string): Promise<void> {
  try {
    await shell.openExternal(url)
  } catch (err) {
    logger.warn({ err, url }, 'mfe:// openExternal failed')
    throw err
  }
}

/** Open parent folder and select the file (or reveal a folder entry). */
export async function revealInCustomExplorer(absolutePath: string): Promise<void> {
  await openMfeUrl(mfeRevealUrl(absolutePath))
}

/** Open a folder as a tab with no selection. */
export async function openFolderInCustomExplorer(absolutePath: string): Promise<void> {
  await openMfeUrl(mfeOpenUrl(absolutePath))
}

/**
 * Reveal files; open directories. Used by the generic system:openPath channel.
 */
export async function openPathInCustomExplorer(absolutePath: string): Promise<void> {
  try {
    const s = await stat(absolutePath)
    if (s.isDirectory()) {
      await openFolderInCustomExplorer(absolutePath)
      return
    }
  } catch {
    /* missing path — still try reveal so the explorer can show an error */
  }
  await revealInCustomExplorer(absolutePath)
}
