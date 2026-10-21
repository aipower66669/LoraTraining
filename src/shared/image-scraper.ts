/**
 * Browser-safe helpers for the Image Scraper (renderer + guest preload).
 * Supports Pinterest and Google Images.
 */

export const IMAGE_SCRAPER_SOURCES = ['pinterest', 'google'] as const
export type ImageScraperSource = (typeof IMAGE_SCRAPER_SOURCES)[number]

export type ImageScraperSourceInfo = {
  id: ImageScraperSource
  label: string
  startUrl: string
  /** Electron <webview> session partition (keeps logins separate). */
  partition: string
  hint: string
}

export const IMAGE_SCRAPER_SOURCE_INFO: Record<ImageScraperSource, ImageScraperSourceInfo> = {
  pinterest: {
    id: 'pinterest',
    label: 'Pinterest',
    startUrl: 'https://www.pinterest.com/',
    partition: 'persist:image-scraper-pinterest',
    hint: 'Click any pin image to download'
  },
  google: {
    id: 'google',
    label: 'Google Images',
    startUrl: 'https://www.google.com/imghp?hl=en',
    partition: 'persist:image-scraper-google',
    hint: 'Click a result (prefers full-size imgurl)'
  }
}

export function parseImageScraperSource(raw: unknown): ImageScraperSource {
  return raw === 'google' ? 'google' : 'pinterest'
}

const PINIMG_HOST = /(^|\.)pinimg\.com$/i
const PINTEREST_HOST = /(^|\.)pinterest\.[a-z.]+$/i
const GSTATIC_HOST = /(^|\.)gstatic\.com$/i
const GOOGLEUSERCONTENT_HOST = /(^|\.)googleusercontent\.com$/i

export function isPinimgHost(hostname: string): boolean {
  return PINIMG_HOST.test(hostname)
}

export function isPinterestHost(hostname: string): boolean {
  return PINTEREST_HOST.test(hostname) || isPinimgHost(hostname)
}

function looksLikeHtmlNavigation(u: URL): boolean {
  const host = u.hostname.toLowerCase()
  const path = u.pathname.toLowerCase()
  if (host.includes('google.')) {
    if (
      path.startsWith('/search') ||
      path.startsWith('/imgres') ||
      path === '/imghp' ||
      path.startsWith('/url')
    ) {
      return true
    }
  }
  if (PINTEREST_HOST.test(host) && !isPinimgHost(host)) {
    if (!/\.(jpe?g|png|webp|gif|bmp|avif)(\?|$)/i.test(path)) return true
  }
  return false
}

/**
 * True if this URL is worth downloading as a dataset image.
 * Pass `trustAsImage` when the URL came from Google's `imgurl=` (often no extension).
 */
export function isScrapableImageUrl(
  raw: string,
  opts?: { trustAsImage?: boolean }
): boolean {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    if (looksLikeHtmlNavigation(u)) return false
    if (opts?.trustAsImage) return true
    if (isPinimgHost(u.hostname)) return true
    if (GSTATIC_HOST.test(u.hostname) || GOOGLEUSERCONTENT_HOST.test(u.hostname)) return true
    const path = u.pathname.toLowerCase()
    return /\.(jpe?g|png|webp|gif|bmp|avif)(\?|$)/i.test(path)
  } catch {
    return false
  }
}

/**
 * Prefer full-resolution pinimg URL over gallery thumbs (236x / 474x / 736x).
 * `…/236x/ab/cd/ef/hash.jpg` → `…/originals/ab/cd/ef/hash.jpg`
 */
export function upgradePinterestImageUrl(raw: string): string {
  try {
    const u = new URL(raw)
    if (!isPinimgHost(u.hostname)) return raw
    u.pathname = u.pathname
      .replace(/\/\d+x\d*\//i, '/originals/')
      .replace(/\/\d+x\//i, '/originals/')
    return u.toString()
  } catch {
    return raw
  }
}

/** Extract original image URL from a Google Images `/imgres?imgurl=` link. */
export function extractImgUrlFromHref(href: string, base?: string): string | null {
  try {
    const u = new URL(href, base)
    const imgurl = u.searchParams.get('imgurl')
    if (imgurl && /^https?:\/\//i.test(imgurl)) return imgurl
  } catch {
    /* ignore */
  }
  return null
}

/** Pick the largest candidate from an img srcset string. */
export function largestSrcFromSrcset(srcset: string): string | null {
  let bestUrl: string | null = null
  let bestW = -1
  for (const part of srcset.split(',')) {
    const bits = part.trim().split(/\s+/)
    const url = bits[0]
    if (!url) continue
    const desc = bits[1] ?? ''
    const w = desc.endsWith('w') ? Number.parseInt(desc, 10) : Number.NaN
    const score = Number.isFinite(w) ? w : 0
    if (score >= bestW) {
      bestW = score
      bestUrl = url
    }
  }
  return bestUrl
}

export type ScrapedUrlCandidate = {
  url: string
  /** From Google `imgurl=` — may lack a file extension. */
  trustAsImage?: boolean
}

/**
 * Resolve the best download URL from a clicked image + nearby link hrefs.
 * Prefers Google `imgurl=` originals, then data-* attrs, then srcset/src (Pinterest upgraded).
 */
export function resolveScrapedImageUrl(input: {
  src?: string | null
  currentSrc?: string | null
  srcset?: string | null
  dataAttrs?: Record<string, string | null | undefined>
  hrefs?: Array<string | null | undefined>
  pageUrl?: string
}): ScrapedUrlCandidate | null {
  const pageUrl = input.pageUrl || undefined

  for (const href of input.hrefs ?? []) {
    if (!href) continue
    const fromGoogle = extractImgUrlFromHref(href, pageUrl)
    if (fromGoogle) {
      const upgraded = upgradePinterestImageUrl(fromGoogle)
      if (isScrapableImageUrl(upgraded, { trustAsImage: true })) {
        return { url: upgraded, trustAsImage: true }
      }
    }
  }

  const dataKeys = ['data-ou', 'data-iurl', 'data-src', 'data-iml']
  for (const key of dataKeys) {
    const raw = input.dataAttrs?.[key]
    if (!raw || raw.startsWith('data:')) continue
    const upgraded = upgradePinterestImageUrl(raw)
    if (isScrapableImageUrl(upgraded, { trustAsImage: true })) {
      return { url: upgraded, trustAsImage: true }
    }
  }

  const fromSet = input.srcset ? largestSrcFromSrcset(input.srcset) : null
  const raw = fromSet || input.currentSrc || input.src || null
  if (!raw || raw.startsWith('data:')) return null
  const upgraded = upgradePinterestImageUrl(raw)
  if (!isScrapableImageUrl(upgraded)) return null
  return { url: upgraded }
}
