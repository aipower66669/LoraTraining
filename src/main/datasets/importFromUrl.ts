import { createHash } from 'node:crypto'
import { access, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { extname, join } from 'node:path'
import sharp from 'sharp'
import { appError } from '@shared/errors'
import { IMAGE_EXTENSIONS } from '@shared/schemas/dataset'
import { isScrapableImageUrl, upgradePinterestImageUrl } from '@shared/image-scraper'
import { assertAbsolutePath, assertInsideRoot } from '../security/path-guards'
import { getDatasetRecord, rescanDataset } from './store'

const KEEP_EXT = new Set(['.jpg', '.jpeg', '.png'])

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function extFromContentType(ct: string | null): string | null {
  if (!ct) return null
  const base = ct.split(';')[0]?.trim().toLowerCase() ?? ''
  switch (base) {
    case 'image/jpeg':
      return '.jpg'
    case 'image/png':
      return '.png'
    case 'image/webp':
      return '.webp'
    case 'image/gif':
      return '.gif'
    case 'image/bmp':
    case 'image/x-ms-bmp':
      return '.bmp'
    default:
      return null
  }
}

function extFromUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname
    const ext = extname(path).toLowerCase()
    return IMAGE_EXTENSIONS.has(ext) ? ext : null
  } catch {
    return null
  }
}

function shortHash(url: string): string {
  return createHash('sha1').update(url).digest('hex').slice(0, 10)
}

function defaultReferrer(pageUrl?: string): string {
  if (pageUrl) {
    try {
      const u = new URL(pageUrl)
      if (u.hostname.includes('google.')) return 'https://www.google.com/'
      if (u.hostname.includes('pinterest.')) return 'https://www.pinterest.com/'
    } catch {
      /* ignore */
    }
  }
  return 'https://www.pinterest.com/'
}

/**
 * Download an image URL into a dataset folder (Image Scraper).
 * Non-JPG/PNG payloads are re-encoded to JPG for AI Toolkit friendliness.
 */
export async function importImageFromUrl(input: {
  datasetId: string
  url: string
  referrer?: string
  /** When true, allow extensionless CDN URLs (e.g. Google `imgurl=`). */
  trustAsImage?: boolean
}): Promise<{ fileName: string; converted: boolean }> {
  const upgraded = upgradePinterestImageUrl(input.url.trim())
  if (!isScrapableImageUrl(upgraded, { trustAsImage: input.trustAsImage === true })) {
    throw appError('validation', 'URL is not a supported image link')
  }

  const ds = await getDatasetRecord(input.datasetId)
  const root = assertAbsolutePath(ds.folderPath)

  const res = await fetch(upgraded, {
    redirect: 'follow',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      Referer: input.referrer?.trim() || defaultReferrer(input.referrer)
    }
  })
  if (!res.ok) {
    throw appError(
      'process-failed',
      `Download failed (${res.status})`,
      { remediation: 'Try another image, or open the full-size preview and click again.' }
    )
  }

  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 32) {
    throw appError('validation', 'Downloaded file is empty or too small')
  }

  const ct = res.headers.get('content-type')
  // Reject HTML error pages disguised as downloads.
  if (ct && /text\/html/i.test(ct)) {
    throw appError(
      'process-failed',
      'Download returned a web page, not an image',
      { remediation: 'Click the full-size image preview, not a thumbnail link.' }
    )
  }

  let ext = extFromContentType(ct) ?? extFromUrl(upgraded) ?? '.jpg'
  if (!IMAGE_EXTENSIONS.has(ext)) ext = '.jpg'

  let outBuf = buf
  let converted = false
  if (!KEEP_EXT.has(ext)) {
    try {
      outBuf = await sharp(buf).rotate().jpeg({ quality: 92, mozjpeg: true }).toBuffer()
      ext = '.jpg'
      converted = true
    } catch {
      throw appError(
        'process-failed',
        'Could not decode image',
        { remediation: 'The link may be a video or blocked — try a different image.' }
      )
    }
  }

  const stem = `img_${shortHash(upgraded)}`
  let fileName = `${stem}${ext}`
  let dest = assertInsideRoot(root, join(root, fileName))
  if (await pathExists(dest)) {
    // Same URL already saved — treat as success (idempotent click).
    return { fileName, converted }
  }

  // Extremely unlikely hash clash with different URL — bump suffix.
  for (let i = 2; await pathExists(dest); i++) {
    fileName = `${stem}_${i}${ext}`
    dest = assertInsideRoot(root, join(root, fileName))
  }

  await writeFile(dest, outBuf)
  await rescanDataset(input.datasetId)
  return { fileName, converted }
}
