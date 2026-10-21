import { describe, expect, it } from 'vitest'
import { jpgTargetFileName, needsConvertToJpg } from '@shared/image-convert'

describe('needsConvertToJpg', () => {
  it('keeps png and jpeg family', () => {
    expect(needsConvertToJpg('a.png')).toBe(false)
    expect(needsConvertToJpg('a.PNG')).toBe(false)
    expect(needsConvertToJpg('a.jpg')).toBe(false)
    expect(needsConvertToJpg('a.JPEG')).toBe(false)
  })

  it('flags webp and bmp', () => {
    expect(needsConvertToJpg('a.webp')).toBe(true)
    expect(needsConvertToJpg('a.WEBP')).toBe(true)
    expect(needsConvertToJpg('a.bmp')).toBe(true)
  })

  it('builds .jpg target from stem', () => {
    expect(jpgTargetFileName('shot.WEBP')).toBe('shot.jpg')
    expect(jpgTargetFileName('shot.bmp')).toBe('shot.jpg')
  })
})
