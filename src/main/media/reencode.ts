import sharp from 'sharp'
import { extname } from 'node:path'
import { appError } from '@shared/errors'

/**
 * Re-encode a raw image buffer (typically ComfyUI's PNG output) so its bytes
 * actually match the target file extension — the Upscale/Detail rename-swap
 * always writes back under the original image's own filename, and everything
 * downstream (media protocol `Content-Type`, thumbnailer, training) infers
 * format purely from the extension.
 */
export async function reencodeToExtension(input: Buffer, targetFileName: string): Promise<Buffer> {
  const ext = extname(targetFileName).toLowerCase()
  const image = sharp(input, { failOn: 'none', limitInputPixels: false }).rotate()
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return image.jpeg({ quality: 95, mozjpeg: true }).toBuffer()
    case '.png':
      return image.png().toBuffer()
    case '.webp':
      return image.webp({ quality: 95 }).toBuffer()
    case '.bmp':
      throw appError(
        'upscale',
        'BMP images cannot be re-encoded after upscaling.',
        {
          remediation:
            'Convert this image to JPG first (right-click → bulk tools → Convert to JPG), then try Upscale again.'
        }
      )
    default:
      throw appError('upscale', `Unsupported image format for upscale result: ${ext || '(none)'}`)
  }
}
