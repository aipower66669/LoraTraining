import type { ToolConfigFlags } from '@shared/tool-config'
import type { DatasetsMiddleTab } from '../store/types'

const COMFY_MIDDLE_TABS = new Set<DatasetsMiddleTab>([
  'validate',
  'weight',
  'stress',
  'upscale',
  'context',
  'expression'
])

export function isDatasetMiddleTabAvailable(
  tab: DatasetsMiddleTab,
  flags: ToolConfigFlags
): boolean {
  if (COMFY_MIDDLE_TABS.has(tab)) return flags.comfy
  return true
}

export function firstUnavailableMiddleTab(
  tab: DatasetsMiddleTab,
  flags: ToolConfigFlags
): DatasetsMiddleTab | null {
  return isDatasetMiddleTabAvailable(tab, flags) ? null : tab
}
