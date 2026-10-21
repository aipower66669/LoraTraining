import { shell } from 'electron'
import { stat } from 'node:fs/promises'

/** Select the file in Windows Explorer. */
export async function revealInExplorer(absolutePath: string): Promise<void> {
  shell.showItemInFolder(absolutePath)
}

/** Open a folder in Windows Explorer. */
export async function openFolderInExplorer(absolutePath: string): Promise<void> {
  const err = await shell.openPath(absolutePath)
  if (err) throw new Error(err)
}

/**
 * Reveal files; open directories. Used by the generic system:openPath channel.
 */
export async function openPathInExplorer(absolutePath: string): Promise<void> {
  try {
    const s = await stat(absolutePath)
    if (s.isDirectory()) {
      await openFolderInExplorer(absolutePath)
      return
    }
  } catch {
    /* missing path — still try reveal */
  }
  await revealInExplorer(absolutePath)
}
