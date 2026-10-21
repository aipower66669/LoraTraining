import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrateOriginalSiblingsToAds } from '../main/images/imageEdit'
import { originalSiblingFileName } from '../shared/imageEdit'

describe('migrate .original → ADS', () => {
  it('names legacy siblings as {file}.original', () => {
    expect(originalSiblingFileName('photo.jpg')).toBe('photo.jpg.original')
  })

  it('skips orphan .original when live image is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lt-ads-mig-'))
    await writeFile(join(dir, originalSiblingFileName('a.jpg')), Buffer.from([1, 2, 3]))
    const result = await migrateOriginalSiblingsToAds(dir)
    expect(result.migrated).toBe(0)
    expect(result.failed).toBe(0)
    expect(result.skipped).toBe(1)
  })

  it('skips non-image .original names', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lt-ads-mig-'))
    await writeFile(join(dir, 'notes.txt.original'), Buffer.from([1]))
    const result = await migrateOriginalSiblingsToAds(dir)
    expect(result.migrated).toBe(0)
    expect(result.skipped).toBe(1)
  })
})
