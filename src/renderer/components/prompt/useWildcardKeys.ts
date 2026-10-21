import { useEffect, useState } from 'react'
import { useAppStore } from '../../store'

let cachedKeys: string[] = []
let cacheFolder: string | null = null
let inflight: Promise<string[]> | null = null
let inflightFolder = ''
const listeners = new Set<() => void>()

async function fetchKeys(folder: string): Promise<string[]> {
  const trimmed = folder.trim()
  if (!trimmed) {
    cachedKeys = []
    cacheFolder = ''
    return []
  }
  if (cacheFolder === trimmed) return cachedKeys
  if (inflight && inflightFolder === trimmed) return inflight

  inflightFolder = trimmed
  inflight = (async () => {
    try {
      const r = await window.loraTraining.wildcards.listKeys()
      if (!r.ok) {
        cachedKeys = []
        cacheFolder = trimmed
        return []
      }
      cachedKeys = r.value
      cacheFolder = trimmed
      return cachedKeys
    } catch {
      cachedKeys = []
      cacheFolder = trimmed
      return []
    } finally {
      inflight = null
      inflightFolder = ''
    }
  })()
  return inflight
}

/** Drop cached keys and notify hooks so they re-scan disk. */
export function invalidateWildcardKeysCache(): void {
  cacheFolder = null
  cachedKeys = []
  inflight = null
  inflightFolder = ''
  for (const listener of listeners) listener()
}

/**
 * Wildcard autocomplete keys from Settings → ComfyUI → Wildcards folder.
 * Reloads when `comfy.wildcardLibraryFolder` changes or cache is invalidated.
 */
export function useWildcardKeys(): string[] {
  const folder = useAppStore((s) => s.settings?.comfy.wildcardLibraryFolder ?? '')
  const [tick, setTick] = useState(0)
  const [keys, setKeys] = useState<string[]>(() =>
    cacheFolder === folder.trim() ? cachedKeys : []
  )

  useEffect(() => {
    const onInvalidate = (): void => setTick((n) => n + 1)
    listeners.add(onInvalidate)
    return () => {
      listeners.delete(onInvalidate)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetchKeys(folder).then((next) => {
      if (!cancelled) setKeys(next)
    })
    return () => {
      cancelled = true
    }
  }, [folder, tick])

  return keys
}
