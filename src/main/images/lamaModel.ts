import { createWriteStream } from 'node:fs'
import { mkdir, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { appError } from '@shared/errors'
import { getAppDataRoot } from '../settings/store'
import { logger } from '../logging'

/** HuggingFace Carve LaMa ONNX (fixed 512×512). */
export const LAMA_MODEL_URL =
  'https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx'
export const LAMA_MODEL_FILENAME = 'lama_fp32.onnx'

function modelsDir(): string {
  return join(getAppDataRoot(), 'models')
}

export function lamaModelPath(): string {
  return join(modelsDir(), LAMA_MODEL_FILENAME)
}

async function fileReady(path: string): Promise<boolean> {
  try {
    const st = await stat(path)
    return st.isFile() && st.size > 1_000_000
  } catch {
    return false
  }
}

let inflight: Promise<{ path: string; downloaded: boolean }> | null = null

/**
 * Ensure LaMa ONNX exists under AppData `models/`. Downloads once from HuggingFace.
 */
export async function ensureLamaModel(): Promise<{ path: string; downloaded: boolean }> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const dest = lamaModelPath()
      if (await fileReady(dest)) {
        return { path: dest, downloaded: false }
      }

      await mkdir(modelsDir(), { recursive: true })
      const tmp = `${dest}.download`
      try {
        await unlink(tmp).catch(() => undefined)
        logger.info({ url: LAMA_MODEL_URL, dest }, 'Downloading LaMa ONNX model')
        const res = await fetch(LAMA_MODEL_URL, { redirect: 'follow' })
        if (!res.ok || !res.body) {
          throw appError(
            'process-failed',
            `Failed to download LaMa model (HTTP ${res.status}). Check your network and try again.`
          )
        }
        const nodeStream = Readable.fromWeb(
          res.body as unknown as import('node:stream/web').ReadableStream
        )
        await pipeline(nodeStream, createWriteStream(tmp))
        await rename(tmp, dest)
        if (!(await fileReady(dest))) {
          throw appError('process-failed', 'LaMa model download completed but file looks invalid.')
        }
        logger.info({ dest, bytes: (await stat(dest)).size }, 'LaMa ONNX model ready')
        return { path: dest, downloaded: true }
      } catch (e) {
        await unlink(tmp).catch(() => undefined)
        if (e && typeof e === 'object' && 'code' in e && 'message' in e) throw e
        throw appError(
          'process-failed',
          e instanceof Error ? e.message : 'Failed to download LaMa model'
        )
      }
    } finally {
      inflight = null
    }
  })()
  return inflight
}
