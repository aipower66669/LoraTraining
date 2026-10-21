import { describe, expect, it } from 'vitest'
import {
  DATASET_IMAGE_DRAG_MIME,
  encodeDatasetImageDragPayload,
  isDatasetImageDrag,
  parseDatasetImageDragPayload
} from '@shared/dataset-image-drag'

describe('dataset-image-drag', () => {
  it('round-trips payload', () => {
    const raw = encodeDatasetImageDragPayload({
      sourceDatasetId: 'ds1',
      fileNames: ['a.jpg', 'b.png']
    })
    expect(parseDatasetImageDragPayload(raw)).toEqual({
      sourceDatasetId: 'ds1',
      fileNames: ['a.jpg', 'b.png']
    })
  })

  it('rejects empty / invalid', () => {
    expect(parseDatasetImageDragPayload('')).toBeNull()
    expect(parseDatasetImageDragPayload('{}')).toBeNull()
    expect(
      parseDatasetImageDragPayload(JSON.stringify({ sourceDatasetId: 'x', fileNames: [] }))
    ).toBeNull()
  })

  it('detects mime in type list', () => {
    expect(isDatasetImageDrag([DATASET_IMAGE_DRAG_MIME, 'text/plain'])).toBe(true)
    expect(isDatasetImageDrag(['Files', 'text/uri-list'])).toBe(false)
  })
})
