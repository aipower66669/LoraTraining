import { protocol, net } from 'electron'
import { pathToFileURL } from 'node:url'
import { ensureLamaModel, lamaModelPath, LAMA_MODEL_FILENAME } from '../images/lamaModel'
import { logger } from '../logging'

/** Serve cached ONNX weights from AppData `models/`. Call after app ready. */
export function attachModelProtocolHandler(): void {
  protocol.handle('loratraining-model', async (request) => {
    try {
      await ensureLamaModel()
      const fileUrl = pathToFileURL(lamaModelPath()).href
      return net.fetch(fileUrl)
    } catch (err) {
      logger.warn({ err, url: request.url }, 'model protocol error')
      return new Response('Model unavailable', { status: 500 })
    }
  })
}

/** Renderer URL for ORT InferenceSession.create (fetchable). */
export function lamaModelFetchUrl(): string {
  return `loratraining-model://local/${LAMA_MODEL_FILENAME}`
}
