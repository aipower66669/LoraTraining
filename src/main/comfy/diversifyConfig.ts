import {
  DiversifyConfigSchema,
  type DiversifyConfig,
  type DiversifyMode
} from '@shared/diversify-config'
import { getDatasetRecord } from '../datasets/store'
import { loadSettings, patchSettings } from '../settings/store'

function settingsKey(
  mode: DiversifyMode
): 'lastDiversifyContextConfig' | 'lastDiversifyExpressionConfig' {
  return mode === 'context' ? 'lastDiversifyContextConfig' : 'lastDiversifyExpressionConfig'
}

async function loadLastConfig(mode: DiversifyMode): Promise<DiversifyConfig> {
  const settings = await loadSettings()
  return DiversifyConfigSchema.parse(settings[settingsKey(mode)] ?? {})
}

export async function getDiversifyConfig(
  mode: DiversifyMode,
  datasetId: string,
  _fileName: string
): Promise<DiversifyConfig> {
  await getDatasetRecord(datasetId)
  // Last-used prompt only — never fill from the image caption (that defeats diversification).
  return loadLastConfig(mode)
}

export async function updateDiversifyConfig(
  mode: DiversifyMode,
  datasetId: string,
  _fileName: string,
  patch: Partial<DiversifyConfig>
): Promise<DiversifyConfig> {
  await getDatasetRecord(datasetId)
  const base = await loadLastConfig(mode)
  const next = DiversifyConfigSchema.parse({
    prompt: patch.prompt !== undefined ? patch.prompt : base.prompt,
    seed: patch.seed ?? base.seed,
    count: patch.count ?? base.count
  })
  await patchSettings({ [settingsKey(mode)]: next })
  return next
}
