import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { quickCaptionCoverage } from '../main/datasets/captionCoverage'

describe('quickCaptionCoverage', () => {
  it('counts images and matching caption files without reading contents', async () => {
    const root = join(tmpdir(), `lt-cap-${Date.now()}`)
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'a.jpg'), 'x')
    await writeFile(join(root, 'a.txt'), 'caption')
    await writeFile(join(root, 'b.PNG'), 'x')
    // no b.txt
    await writeFile(join(root, 'notes.md'), 'ignore')
    await mkdir(join(root, 'subdir'))

    expect(await quickCaptionCoverage(root)).toEqual({ images: 2, captions: 1 })
  })
})
