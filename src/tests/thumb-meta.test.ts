import { describe, expect, it } from 'vitest'
import { parseThumbMeta } from '@main/media/thumbs'

describe('parseThumbMeta', () => {
  it('preserves tipKey so tip ADS edits invalidate the cache', () => {
    expect(
      parseThumbMeta({
        sourceName: 'a.jpg',
        size: 10,
        mtimeMs: 100,
        tipKey: '100-10-v1-VER_1-99'
      })
    ).toEqual({
      sourceName: 'a.jpg',
      size: 10,
      mtimeMs: 100,
      tipKey: '100-10-v1-VER_1-99'
    })
  })

  it('omits missing tipKey', () => {
    expect(parseThumbMeta({ sourceName: 'a.jpg', size: 1, mtimeMs: 2 })).toEqual({
      sourceName: 'a.jpg',
      size: 1,
      mtimeMs: 2,
      tipKey: undefined
    })
  })
})
