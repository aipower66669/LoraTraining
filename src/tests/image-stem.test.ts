import { describe, expect, it } from 'vitest'
import { imageStem } from '@shared/schemas/dataset'
import { basename, extname } from 'node:path'

describe('imageStem', () => {
  it('strips mixed-case image extensions', () => {
    expect(imageStem('photo.JPG')).toBe('photo')
    expect(imageStem('photo.JPEG')).toBe('photo')
    expect(imageStem('photo.PnG')).toBe('photo')
    expect(imageStem('photo.webp')).toBe('photo')
  })

  it('does not break when lowercased ext is passed to basename (the old bug)', () => {
    const fileName = '0028.JPG'
    const lower = extname(fileName).toLowerCase()
    expect(basename(fileName, lower)).toBe('0028.JPG')
    expect(imageStem(fileName)).toBe('0028')
  })
})
