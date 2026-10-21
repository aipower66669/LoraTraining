import { protocol } from 'electron'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { assertInsideRoot } from '../security/path-guards'
import { logger } from '../logging'
import { ensureDatasetThumb } from './thumbs'

const folderByDataset = new Map<string, string>()

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp'
}

const CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0'
} as const

/** Browser may cache thumbs briefly; bust query must change when tip ADS updates. */
const THUMB_CACHE_HEADERS = {
  'Cache-Control': 'private, max-age=30',
  'Content-Type': 'image/jpeg'
} as const

export function registerDatasetFolder(datasetId: string, folderPath: string): void {
  folderByDataset.set(datasetId, folderPath)
}

export function unregisterDatasetFolder(datasetId: string): void {
  folderByDataset.delete(datasetId)
}

export function getRegisteredFolder(datasetId: string): string | undefined {
  return folderByDataset.get(datasetId)
}

/** All dataset ids currently registered for the media protocol. */
export function listRegisteredDatasetIds(): string[] {
  return [...folderByDataset.keys()]
}

export function registerMediaProtocol(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'loratraining-media',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        bypassCSP: true,
        stream: true
      }
    },
    {
      scheme: 'loratraining-model',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        bypassCSP: true,
        stream: true,
        corsEnabled: true
      }
    },
    {
      scheme: 'loratraining-ort',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        bypassCSP: true,
        stream: true,
        corsEnabled: true
      }
    }
  ])
}

type ParsedMediaPath =
  | { kind: 'dataset'; datasetId: string; fileName: string; thumb: boolean; original: boolean }
  | { kind: 'invalid' }

function parseMediaPath(url: URL): ParsedMediaPath {
  // loratraining-media://dataset/{id}/{fileName} — tip (or $DATA)
  // loratraining-media://dataset/{id}/thumb/{fileName}
  // loratraining-media://dataset/{id}/original/{fileName} — pristine $DATA only
  const parts = url.pathname.replace(/^\/+/, '').split('/').filter(Boolean)
  const host = url.hostname

  let rest = parts
  if (host === 'dataset') {
    // host carries "dataset"; pathname is /{id}/...
  } else if (parts[0] === 'dataset') {
    rest = parts.slice(1)
  } else {
    return { kind: 'invalid' }
  }
  const datasetId = rest[0]
  if (!datasetId) return { kind: 'invalid' }
  if (rest[1] === 'thumb') {
    return {
      kind: 'dataset',
      datasetId,
      fileName: rest.slice(2).join('/'),
      thumb: true,
      original: false
    }
  }
  if (rest[1] === 'original') {
    return {
      kind: 'dataset',
      datasetId,
      fileName: rest.slice(2).join('/'),
      thumb: false,
      original: true
    }
  }
  return {
    kind: 'dataset',
    datasetId,
    fileName: rest.slice(1).join('/'),
    thumb: false,
    original: false
  }
}

/**
 * Serve dataset images without piping Node ReadStreams into Response.
 * Chromium aborts in-flight thumbs when scrolling/switching datasets; undici then
 * double-closes the web stream and crashes the main process with ERR_INVALID_STATE.
 */
export function attachMediaProtocolHandler(): void {
  protocol.handle('loratraining-media', async (request) => {
    try {
      const url = new URL(request.url)
      const parsed = parseMediaPath(url)
      if (parsed.kind === 'invalid') {
        return new Response('Bad request', { status: 400 })
      }

      const { datasetId, fileName, thumb, original } = parsed
      if (!datasetId || !fileName) {
        return new Response('Bad request', { status: 400 })
      }
      const folder = folderByDataset.get(datasetId)
      if (!folder) {
        return new Response('Unknown dataset', { status: 404 })
      }
      const decoded = decodeURIComponent(fileName)
      const hostFile = assertInsideRoot(folder, join(folder, decoded))
      if (!existsSync(hostFile)) {
        return new Response('Not found', { status: 404 })
      }

      const { resolveImageAdsStream } = await import('../images/imageEdit')
      // `original` → pristine `$DATA`; default → tip when VER_* exist.
      const resolved = await resolveImageAdsStream(hostFile, original ? null : undefined)
      const full = resolved.openPath
      if (!existsSync(full) && full !== hostFile) {
        // Tip stream missing — fall back to $DATA
        if (!existsSync(hostFile)) {
          return new Response('Not found', { status: 404 })
        }
      }
      const openFull = existsSync(full) ? full : hostFile

      if (thumb) {
        try {
          const data = await ensureDatasetThumb(datasetId, openFull, decoded, folder, {
            cacheKey: resolved.cacheKey
          })
          return new Response(new Uint8Array(data), { headers: { ...THUMB_CACHE_HEADERS } })
        } catch (err) {
          logger.warn({ err, full: openFull }, 'thumb generate failed — falling back to full image')
          // Fall through to full file so the UI still shows something.
        }
      }

      const mime = MIME[extname(decoded).toLowerCase()] ?? 'application/octet-stream'
      try {
        const data = await readFile(openFull)
        return new Response(new Uint8Array(data), {
          headers: {
            'Content-Type': mime,
            ...CACHE_HEADERS
          }
        })
      } catch (readErr) {
        logger.warn({ err: readErr, full: openFull }, 'media file read failed')
        return new Response('Unreadable', { status: 404 })
      }
    } catch (err) {
      logger.warn({ err }, 'media protocol error')
      return new Response('Forbidden', { status: 403 })
    }
  })
}

export function mediaUrl(datasetId: string, fileName: string, cacheBust?: number | string): string {
  const path = `loratraining-media://dataset/${datasetId}/${encodeURIComponent(fileName)}`
  return cacheBust != null ? `${path}?v=${encodeURIComponent(String(cacheBust))}` : path
}

export function mediaThumbUrl(
  datasetId: string,
  fileName: string,
  cacheBust?: number | string
): string {
  const path = `loratraining-media://dataset/${datasetId}/thumb/${encodeURIComponent(fileName)}`
  return cacheBust != null ? `${path}?v=${encodeURIComponent(String(cacheBust))}` : path
}

/** Serves pristine `$DATA` (original) for an image that has tip ADS versions. */
export function mediaOriginalUrl(
  datasetId: string,
  fileName: string,
  cacheBust?: number | string
): string {
  const path = `loratraining-media://dataset/${datasetId}/original/${encodeURIComponent(fileName)}`
  return cacheBust != null ? `${path}?v=${encodeURIComponent(String(cacheBust))}` : path
}
