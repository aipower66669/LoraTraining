import { extname } from 'node:path'
import { IMAGE_EXTENSIONS, imageStem } from './schemas/dataset'

/** Formats already accepted for training — leave these alone. */
export const KEEP_AS_IS_EXTS = new Set(['.png', '.jpg', '.jpeg'])

export function needsConvertToJpg(fileName: string): boolean {
  const ext = extname(fileName).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext) && !KEEP_AS_IS_EXTS.has(ext)
}

/** Destination basename for a convert-to-jpg operation (same stem). */
export function jpgTargetFileName(fileName: string): string {
  return `${imageStem(fileName)}.jpg`
}
