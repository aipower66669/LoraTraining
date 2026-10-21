import { describe, expect, it } from 'vitest'
import {
  IMAGE_VER_MAX,
  isEditableImagePath,
  isImageVersionStreamName,
  isSaveAsImagePath,
  parseVerCount,
  renumberAfterDrop,
  renumberAfterShiftOldest,
  sharpFormatForExt,
  shouldUseImageVersions,
  tipVersionFromStreamNames,
  verStreamName
} from '../shared/imageEdit'

describe('imageEdit helpers', () => {
  it('allows dataset raster formats', () => {
    expect(isEditableImagePath('C:\\a\\photo.jpg')).toBe(true)
    expect(isEditableImagePath('C:\\a\\photo.PNG')).toBe(true)
    expect(isEditableImagePath('C:\\a\\photo.webp')).toBe(true)
    expect(isEditableImagePath('C:\\a\\photo.bmp')).toBe(true)
  })

  it('tipVersionFromStreamNames picks the highest VER_n', () => {
    expect(tipVersionFromStreamNames(['VER_COUNT', 'VER_1'])).toBe(1)
    expect(tipVersionFromStreamNames(['VER_2', 'VER_1', 'Zone.Identifier'])).toBe(2)
    expect(tipVersionFromStreamNames(['Zone.Identifier'])).toBe(0)
  })

  it('rejects svg/psd/non-images and formats outside IMAGE_EXTENSIONS', () => {
    expect(isEditableImagePath('C:\\a\\icon.svg')).toBe(false)
    expect(isEditableImagePath('C:\\a\\file.psd')).toBe(false)
    expect(isEditableImagePath('C:\\a\\doc.txt')).toBe(false)
    expect(isEditableImagePath('C:\\a\\photo.gif')).toBe(false)
  })

  it('maps extensions to sharp formats', () => {
    expect(sharpFormatForExt('jpg')).toBe('jpeg')
    expect(sharpFormatForExt('bmp')).toBe('jpeg')
    expect(sharpFormatForExt('png')).toBe('png')
    expect(sharpFormatForExt('svg')).toBe(null)
  })

  it('allows broader Save As destinations', () => {
    expect(isSaveAsImagePath('out.gif')).toBe(true)
    expect(isSaveAsImagePath('out.tiff')).toBe(true)
    expect(isSaveAsImagePath('out.svg')).toBe(false)
  })

  it('names VER streams and parses VER_COUNT', () => {
    expect(verStreamName(2)).toBe('VER_2')
    expect(isImageVersionStreamName('VER_COUNT')).toBe(true)
    expect(isImageVersionStreamName('VER_3')).toBe(true)
    expect(isImageVersionStreamName('Caption')).toBe(false)
    expect(parseVerCount('3')).toBe(3)
    expect(parseVerCount('99')).toBe(IMAGE_VER_MAX)
    expect(parseVerCount('nope')).toBe(0)
  })

  it('uses image versions only when opted in on NTFS', () => {
    expect(shouldUseImageVersions(false, false)).toBe(false)
    expect(shouldUseImageVersions(false, true)).toBe(false)
    expect(shouldUseImageVersions(true, false)).toBe(false)
    expect(shouldUseImageVersions(true, true)).toBe(true)
  })

  it('renumbers after drop and shift-oldest', () => {
    const drop = renumberAfterDrop(3, 3)
    expect(drop.newCount).toBe(2)
    expect([...drop.map.entries()]).toEqual([
      [1, 1],
      [2, 2]
    ])
    const shift = renumberAfterShiftOldest(IMAGE_VER_MAX)
    expect(shift.newCount).toBe(IMAGE_VER_MAX - 1)
    expect(shift.map.get(1)).toBeUndefined()
    expect(shift.map.get(2)).toBe(1)
    expect(shift.map.get(IMAGE_VER_MAX)).toBe(IMAGE_VER_MAX - 1)
  })
})
