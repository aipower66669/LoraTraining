import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanFolder } from '../main/datasets/store'

/**
 * scanFolder() stats + reads a caption file per image with bounded concurrency
 * (see src/main/util/concurrency.ts). These tests check the concurrent scan
 * still produces stable, correctly ordered, correctly flagged results.
 */
describe('scanFolder (bounded concurrency)', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  async function freshDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'lora-scan-'))
    tempDirs.push(dir)
    return dir
  }

  it('scans more images than the concurrency limit, sorted, with correct caption flags', async () => {
    const dir = await freshDir()
    const count = 20 // > SCAN_CONCURRENCY (8) so multiple worker batches run
    for (let i = 0; i < count; i++) {
      const name = `img-${String(i).padStart(2, '0')}.png`
      await writeFile(join(dir, name), Buffer.from([0]))
      if (i % 2 === 0) {
        await writeFile(join(dir, `img-${String(i).padStart(2, '0')}.txt`), `caption ${i}`)
      }
    }

    const { images, stats } = await scanFolder(dir, 'txt')

    expect(images).toHaveLength(count)
    expect(images.map((i) => i.fileName)).toEqual(
      [...images].sort((a, b) => a.fileName.localeCompare(b.fileName)).map((i) => i.fileName)
    )
    for (const img of images) {
      const idx = Number(img.fileName.match(/(\d+)/)?.[1])
      expect(img.captionExists).toBe(idx % 2 === 0)
    }
    expect(stats.images).toBe(count)
    expect(stats.captions).toBe(count / 2)
    expect(stats.stemCollisions).toEqual([])
  })

  it('detects stem collisions across extensions and ignores non-image files', async () => {
    const dir = await freshDir()
    await writeFile(join(dir, 'a.jpg'), Buffer.from([0]))
    await writeFile(join(dir, 'a.png'), Buffer.from([0]))
    await writeFile(join(dir, 'b.jpg'), Buffer.from([0]))
    await writeFile(join(dir, 'notes.md'), 'not an image')

    const { images, stats } = await scanFolder(dir, 'txt')

    expect(images.map((i) => i.fileName).sort()).toEqual(['a.jpg', 'a.png', 'b.jpg'])
    expect(stats.stemCollisions).toEqual(['a'])
  })

  it('flags hasOriginal/versionCount from ADS VER_COUNT (not .original siblings)', async () => {
    const dir = await freshDir()
    await writeFile(join(dir, 'upscaled.jpg'), Buffer.from([0]))
    // Legacy sibling is ignored by scan — versions live in ADS after migration.
    await writeFile(join(dir, 'upscaled.jpg.original'), Buffer.from([0]))
    await writeFile(join(dir, 'plain.jpg'), Buffer.from([0]))

    const { images } = await scanFolder(dir, 'txt')

    const upscaled = images.find((i) => i.fileName === 'upscaled.jpg')
    const plain = images.find((i) => i.fileName === 'plain.jpg')
    // Temp dirs are usually not NTFS ADS-capable in CI; both should report no versions.
    expect(upscaled?.hasOriginal).toBe(false)
    expect(upscaled?.versionCount).toBe(0)
    expect(plain?.hasOriginal).toBe(false)
    expect(plain?.versionCount).toBe(0)
  })

  it('leaves hasSpawned false (applied from dataset.json by callers)', async () => {
    const dir = await freshDir()
    await writeFile(join(dir, 'source.jpg'), Buffer.from([0]))
    await writeFile(join(dir, 'source.jpg.spawned'), '')

    const { images } = await scanFolder(dir, 'txt')

    const source = images.find((i) => i.fileName === 'source.jpg')
    expect(source?.hasSpawned).toBe(false)
  })
})
