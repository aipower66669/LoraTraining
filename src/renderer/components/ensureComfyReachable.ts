import { comfyHttpBase } from '@shared/comfy'
import type { AppSettings } from '@shared/schemas/settings'
import { unwrap } from '../store'

const POLL_MS = 2000
const POLL_ATTEMPTS = 120 // ~4 min — cold Comfy / portable installs often need several minutes to bind :8188

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * If ComfyUI is down, ask to launch the configured command, wait until reachable.
 * Returns false if the user cancels or launch/wait fails.
 */
export async function ensureComfyReachable(opts: {
  settings: AppSettings | null
  ask: (o: {
    title: string
    message: string
    confirmLabel?: string
  }) => Promise<boolean>
  setStatus: (msg: string) => void
  setError: (msg: string) => void
}): Promise<boolean> {
  const probe = unwrap(await window.loraTraining.comfy.testConnection()) as {
    ok: boolean
    message: string
  }
  if (probe.ok) return true

  const launchCommand = opts.settings?.comfy.launchCommand?.trim() ?? ''
  const base = opts.settings
    ? comfyHttpBase(opts.settings.comfy)
    : 'ComfyUI'

  if (!launchCommand) {
    opts.setError(
      `${probe.message} Set Settings → ComfyUI → Launch command to your run_nvidia_gpu.bat (or similar), then try again.`
    )
    return false
  }

  const go = await opts.ask({
    title: 'Launch ComfyUI?',
    message: `ComfyUI is not reachable at ${base}.\n\nLaunch it now?\n${launchCommand}`,
    confirmLabel: 'Launch'
  })
  if (!go) return false

  try {
    unwrap(await window.loraTraining.comfy.launch())
  } catch (err) {
    opts.setError(err instanceof Error ? err.message : String(err))
    return false
  }

  opts.setStatus('Waiting for ComfyUI to start…')
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    await sleep(POLL_MS)
    const next = unwrap(await window.loraTraining.comfy.testConnection()) as {
      ok: boolean
      message: string
    }
    if (next.ok) {
      opts.setStatus('ComfyUI is ready')
      return true
    }
    if (i % 4 === 3) {
      opts.setStatus(`Waiting for ComfyUI… (${Math.round(((i + 1) * POLL_MS) / 1000)}s)`)
    }
  }

  opts.setError(
    `ComfyUI was launched but did not become reachable at ${base} in time. Check the ComfyUI window for errors, then try again.`
  )
  return false
}
