import { readdir } from 'node:fs/promises'
import { extname } from 'node:path'
import { IMAGE_EXTENSIONS, imageStem } from '@shared/schemas/dataset'

/**
 * Cheap caption coverage from a single `readdir` — no `stat`, caption reads, or ADS.
 * Used for enqueue / queue gates; full `scanFolder` stays for the Images pane.
 */
export async function quickCaptionCoverage(
  folderPath: string,
  captionExt = 'txt'
): Promise<{ images: number; captions: number }> {
  let entries: string[]
  try {
    entries = await readdir(folderPath)
  } catch {
    return { images: 0, captions: 0 }
  }
  const lower = new Set(entries.map((e) => e.toLowerCase()))
  let images = 0
  let captions = 0
  for (const name of entries) {
    if (!IMAGE_EXTENSIONS.has(extname(name).toLowerCase())) continue
    images++
    const stem = imageStem(name)
    if (lower.has(`${stem}.${captionExt}`.toLowerCase())) captions++
  }
  return { images, captions }
}
