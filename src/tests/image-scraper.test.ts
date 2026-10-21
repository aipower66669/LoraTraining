import { describe, expect, it } from 'vitest'
import {
  extractImgUrlFromHref,
  isScrapableImageUrl,
  largestSrcFromSrcset,
  parseImageScraperSource,
  resolveScrapedImageUrl,
  upgradePinterestImageUrl
} from '@shared/image-scraper'

describe('parseImageScraperSource', () => {
  it('defaults unknown to pinterest', () => {
    expect(parseImageScraperSource(undefined)).toBe('pinterest')
    expect(parseImageScraperSource('nope')).toBe('pinterest')
  })

  it('accepts google', () => {
    expect(parseImageScraperSource('google')).toBe('google')
  })
})

describe('upgradePinterestImageUrl', () => {
  it('rewrites thumb sizes to originals', () => {
    expect(
      upgradePinterestImageUrl('https://i.pinimg.com/236x/ab/cd/ef/hash.jpg')
    ).toBe('https://i.pinimg.com/originals/ab/cd/ef/hash.jpg')
    expect(
      upgradePinterestImageUrl('https://i.pinimg.com/736x/ab/cd/ef/hash.jpg')
    ).toBe('https://i.pinimg.com/originals/ab/cd/ef/hash.jpg')
  })

  it('leaves non-pinimg URLs alone', () => {
    const u = 'https://example.com/236x/photo.jpg'
    expect(upgradePinterestImageUrl(u)).toBe(u)
  })
})

describe('extractImgUrlFromHref', () => {
  it('reads Google imgurl param', () => {
    const href =
      'https://www.google.com/imgres?imgurl=https%3A%2F%2Fcdn.example.com%2Fphoto.jpg&imgrefurl=https%3A%2F%2Fexample.com'
    expect(extractImgUrlFromHref(href)).toBe('https://cdn.example.com/photo.jpg')
  })
})

describe('resolveScrapedImageUrl', () => {
  it('prefers Google imgurl over thumbnail src', () => {
    const got = resolveScrapedImageUrl({
      src: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:abc',
      hrefs: [
        'https://www.google.com/imgres?imgurl=https%3A%2F%2Fcdn.example.com%2Ffull.png&imgrefurl=x'
      ]
    })
    expect(got).toEqual({
      url: 'https://cdn.example.com/full.png',
      trustAsImage: true
    })
  })

  it('upgrades Pinterest thumbs from src', () => {
    const got = resolveScrapedImageUrl({
      src: 'https://i.pinimg.com/236x/ab/cd/ef/hash.jpg'
    })
    expect(got?.url).toBe('https://i.pinimg.com/originals/ab/cd/ef/hash.jpg')
  })
})

describe('isScrapableImageUrl', () => {
  it('accepts pinimg', () => {
    expect(isScrapableImageUrl('https://i.pinimg.com/originals/a/b/c/d.jpg')).toBe(true)
  })

  it('rejects non-http', () => {
    expect(isScrapableImageUrl('data:image/png;base64,aaa')).toBe(false)
  })

  it('accepts extensionless when trusted', () => {
    expect(isScrapableImageUrl('https://cdn.example.com/image/abc123')).toBe(false)
    expect(
      isScrapableImageUrl('https://cdn.example.com/image/abc123', { trustAsImage: true })
    ).toBe(true)
  })
})

describe('largestSrcFromSrcset', () => {
  it('picks the widest candidate', () => {
    expect(
      largestSrcFromSrcset(
        'https://i.pinimg.com/236x/a.jpg 236w, https://i.pinimg.com/736x/a.jpg 736w'
      )
    ).toBe('https://i.pinimg.com/736x/a.jpg')
  })
})
