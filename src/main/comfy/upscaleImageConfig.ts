import { join } from 'node:path'
import { UpscaleConfigSchema, type UpscaleConfig } from '@shared/upscale-config'
import { normalizeStyleIndex } from '@shared/validation-sets'
import { imageStem } from '@shared/schemas/dataset'
import { getDatasetRecord } from '../datasets/store'
import { loadSettings, patchSettings } from '../settings/store'
import { assertInsideRoot } from '../security/path-guards'

/** Legacy `{stem}.upscale.json` path — still cleaned up on image delete; no longer read/written. */
export function upscaleConfigPath(folderPath: string, fileName: string): string {
  const stem = imageStem(fileName)
  return assertInsideRoot(folderPath, join(folderPath, `${stem}.upscale.json`))
}

async function captionText(datasetId: string, fileName: string): Promise<string> {
  const { getCaption } = await import('../captions/service')
  const { text } = await getCaption(datasetId, fileName)
  return (text ?? '').trim()
}

/**
 * Last-used library Upscale settings (carry forward across images).
 * Empty prompt → fill from this image's caption.
 */
async function resolveConfigForImage(
  datasetId: string,
  fileName: string
): Promise<UpscaleConfig> {
  let next = UpscaleConfigSchema.parse((await loadSettings()).lastUpscaleConfig ?? {})
  if (!next.prompt.trim()) {
    const caption = await captionText(datasetId, fileName)
    if (caption) next = { ...next, prompt: caption }
  }
  return next
}

/**
 * Config for the Upscale panel / run: library `lastUpscaleConfig`, with an
 * empty prompt filled from this image's caption.
 */
export async function getUpscaleImageConfig(
  datasetId: string,
  fileName: string
): Promise<UpscaleConfig> {
  await getDatasetRecord(datasetId)
  return resolveConfigForImage(datasetId, fileName)
}

/** Persist a patch into library `lastUpscaleConfig` (shared across all images). */
export async function updateUpscaleImageConfig(
  datasetId: string,
  fileName: string,
  patch: Partial<UpscaleConfig>
): Promise<UpscaleConfig> {
  await getDatasetRecord(datasetId)
  const base = await resolveConfigForImage(datasetId, fileName)
  const next = UpscaleConfigSchema.parse({
    prompt: patch.prompt !== undefined ? patch.prompt : base.prompt,
    seed: patch.seed ?? base.seed,
    model: patch.model !== undefined ? patch.model : base.model,
    denoise: patch.denoise ?? base.denoise,
    styleIndex: normalizeStyleIndex(patch.styleIndex ?? base.styleIndex),
    maxSize: patch.maxSize ?? base.maxSize
  })
  await patchSettings({ lastUpscaleConfig: next })
  return next
}
