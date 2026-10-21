import { dirname, resolve } from 'node:path'

/**
 * Folders that may hold `RELEASE_NOTES.md` for a local installer:
 * the update folder, then its parent (the repo when the folder is `release/`).
 */
export function localReleaseNotesSearchDirs(updateFolder: string): string[] {
  const folder = resolve(updateFolder.trim())
  const parent = dirname(folder)
  if (parent.toLowerCase() === folder.toLowerCase()) return [folder]
  return [folder, parent]
}
