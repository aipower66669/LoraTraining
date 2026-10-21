import { useCallback, useEffect, useState } from 'react'
import { unwrap } from '../store'

/**
 * Checkpoint list from ComfyUI. Main process caches once per session;
 * `refresh()` forces a re-fetch.
 */
export function useComfyModels(autoload = true): {
  models: string[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
} {
  const [models, setModels] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (force = true): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const r = unwrap(
        await window.loraTraining.comfy.listModels(force)
      ) as { models: string[] }
      setModels(r.models)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!autoload) return
    void refresh(false)
  }, [autoload, refresh])

  return {
    models,
    loading,
    error,
    refresh: () => refresh(true)
  }
}
