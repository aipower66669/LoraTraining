import { listWildcardKeysFromFolder } from './listKeys'
import { folderReferencesLoraStem } from './scanLoraRefs'
import { loadSettings } from '../settings/store'

/** List autocomplete keys from Settings → ComfyUI → Wildcards folder. */
export async function listWildcardKeys(): Promise<string[]> {
  const settings = await loadSettings()
  const folder = settings.comfy.wildcardLibraryFolder?.trim() ?? ''
  if (!folder) return []
  return listWildcardKeysFromFolder(folder)
}

/**
 * True when Settings → Wildcards folder has at least one `<lora:stem…>` reference
 * (step suffix / brace variants allowed). False if folder unset or no match.
 */
export async function wildcardsReferenceLoraStem(stem: string): Promise<{
  folderConfigured: boolean
  referenced: boolean
}> {
  const settings = await loadSettings()
  const folder = settings.comfy.wildcardLibraryFolder?.trim() ?? ''
  if (!folder) return { folderConfigured: false, referenced: false }
  const referenced = await folderReferencesLoraStem(folder, stem)
  return { folderConfigured: true, referenced }
}
