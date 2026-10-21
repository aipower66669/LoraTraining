import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { reencodeToExtension } from '@main/media/reencode'

async function samplePng(): Promise<Buffer> {
  return sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } }
  })
    .png()
    .toBuffer()
}

describe('reencodeToExtension', () => {
  it('re-encodes to JPEG bytes for a .jpg target', async () => {
    const input = await samplePng()
    const out = await reencodeToExtension(input, 'photo.jpg')
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('jpeg')
  })

  it('re-encodes to JPEG bytes for a .jpeg target (case-insensitive)', async () => {
    const input = await samplePng()
    const out = await reencodeToExtension(input, 'photo.JPEG')
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('jpeg')
  })

  it('keeps PNG bytes for a .png target', async () => {
    const input = await samplePng()
    const out = await reencodeToExtension(input, 'photo.png')
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('png')
  })

  it('re-encodes to WebP bytes for a .webp target', async () => {
    const input = await samplePng()
    const out = await reencodeToExtension(input, 'photo.webp')
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('webp')
  })

  it('rejects .bmp targets with a friendly remediation', async () => {
    const input = await samplePng()
    await expect(reencodeToExtension(input, 'photo.bmp')).rejects.toMatchObject({
      code: 'upscale',
      remediation: expect.stringContaining('Convert to JPG')
    })
  })

  it('rejects unsupported extensions', async () => {
    const input = await samplePng()
    await expect(reencodeToExtension(input, 'photo.tiff')).rejects.toMatchObject({
      code: 'upscale'
    })
  })
})
