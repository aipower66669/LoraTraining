import { useEffect, useRef, useState } from 'react'
import { comfyHttpBase, type ComfyConnectionSettings } from '@shared/comfy'
import type { WorkflowProfile } from '@shared/workflow-profile'
import { loadWorkflowIntoComfyEditor } from './comfyWorkflowEditor'
import { ensureComfyReachable } from './ensureComfyReachable'
import { useConfirm } from './useConfirm'
import { unwrap, useAppStore } from '../store'

export type ComfyWorkflowToolKey = 'validation' | 'upscale' | 'context' | 'expression'

/**
 * Shared Edit-Workflow UI. Each tool uses its own `persist:comfyui-<tool>` partition
 * so ComfyUI's session-cached graph cannot bleed across tools (that bug previously
 * let Save overwrite Validation with whatever Upscale last had open).
 */
export function ComfyWorkflowEditPane(props: {
  toolKey: ComfyWorkflowToolKey
  connection: ComfyConnectionSettings
  toolLabel: string
  hint: string
  loadProfile: () => Promise<{ ok: true; value: WorkflowProfile | null } | { ok: false; error: { message: string } }>
  saveProfile: (
    workflow: unknown,
    uiWorkflow?: unknown
  ) => Promise<{ ok: true; value: unknown } | { ok: false; error: { message: string } }>
}): React.JSX.Element {
  const webviewRef = useRef<HTMLElement | null>(null)
  const loadGen = useRef(0)
  const loadProfileRef = useRef(props.loadProfile)
  const saveProfileRef = useRef(props.saveProfile)
  loadProfileRef.current = props.loadProfile
  saveProfileRef.current = props.saveProfile
  const setStatus = useAppStore((s) => s.setStatus)
  const setError = useAppStore((s) => s.setError)
  const settings = useAppStore((s) => s.settings)
  const { ask, dialog } = useConfirm()
  const [saving, setSaving] = useState(false)
  const [graphReady, setGraphReady] = useState(false)
  const [webviewSrc, setWebviewSrc] = useState<string | null>(null)
  const src = comfyHttpBase(props.connection)
  const partition = `persist:comfyui-${props.toolKey}`

  useEffect(() => {
    let cancelled = false
    setGraphReady(false)
    void (async () => {
      const ready = await ensureComfyReachable({
        settings,
        ask,
        setStatus,
        setError
      })
      if (cancelled || !ready) return
      setWebviewSrc(src)
    })()
    return () => {
      cancelled = true
    }
     
  }, [src, props.toolKey])

  useEffect(() => {
    const el = webviewRef.current as Electron.WebviewTag | null
    if (!el || !webviewSrc) return
    setGraphReady(false)
    el.src = webviewSrc
    const gen = ++loadGen.current

    const injectSavedGraph = async (): Promise<void> => {
      try {
        const profile = unwrap(await loadProfileRef.current())
        const ok = await loadWorkflowIntoComfyEditor(el, profile?.uiWorkflow ?? null)
        // ComfyUI often restores its own last graph after first paint — force again.
        await new Promise((r) => setTimeout(r, 400))
        if (gen !== loadGen.current) return
        const ok2 = await loadWorkflowIntoComfyEditor(el, profile?.uiWorkflow ?? null)
        if (gen !== loadGen.current) return
        if (!ok && !ok2) {
          setGraphReady(false)
          setError(
            `Could not load the saved ${props.toolLabel} workflow into ComfyUI. Save is disabled so you cannot overwrite it by accident.`
          )
          return
        }
        setGraphReady(true)
        setStatus(`${props.toolLabel} workflow loaded — safe to edit / save`)
      } catch (err) {
        if (gen !== loadGen.current) return
        setGraphReady(false)
        setError(err instanceof Error ? err.message : String(err))
      }
    }

    const onDomReady = (): void => {
      void injectSavedGraph()
    }
    el.addEventListener('dom-ready', onDomReady)
    return () => {
      el.removeEventListener('dom-ready', onDomReady)
    }
  }, [webviewSrc, setError, setStatus, props.toolKey, props.toolLabel])

  async function captureWorkflow(): Promise<void> {
    if (!graphReady) {
      setError(`Wait until the ${props.toolLabel} workflow finishes loading before saving.`)
      return
    }
    const wv = webviewRef.current as Electron.WebviewTag | null
    if (!wv) {
      setError('ComfyUI webview is not ready')
      return
    }
    const confirmed = await ask({
      title: `Save ${props.toolLabel} workflow?`,
      message:
        `This overwrites the library ${props.toolLabel} workflow only ` +
        `(not Upscale / Context / Expression). A backup under !WorkflowBackups is written first. ` +
        `Save is refused if the backup cannot be created.`,
      confirmLabel: `Save ${props.toolLabel}`,
      danger: true
    })
    if (!confirmed) return

    setSaving(true)
    try {
      const captured = await wv.executeJavaScript(`
        (async () => {
          if (!window.app || !window.app.graphToPrompt) return null;
          const p = await window.app.graphToPrompt();
          if (!p || !p.output) return null;
          return { output: p.output, workflow: p.workflow ?? null };
        })()
      `)
      if (!captured || typeof captured !== 'object' || !('output' in captured)) {
        throw new Error(
          'Could not read workflow from ComfyUI. Is the editor loaded and a graph present?'
        )
      }
      const { output, workflow: uiWorkflow } = captured as {
        output: unknown
        workflow: unknown
      }
      unwrap(await saveProfileRef.current(output, uiWorkflow))
      setStatus(`${props.toolLabel} workflow saved (!WorkflowBackups)`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="validation-workflow-pane">
      {dialog}
      <div className="toolbar">
        <button
          type="button"
          onClick={() => {
            void (async () => {
              setGraphReady(false)
              const ready = await ensureComfyReachable({
                settings,
                ask,
                setStatus,
                setError
              })
              if (!ready) return
              setWebviewSrc(src)
              ;(webviewRef.current as Electron.WebviewTag | null)?.reload()
            })()
          }}
        >
          Reload
        </button>
        <button
          type="button"
          className="primary"
          disabled={saving || !graphReady}
          onClick={() => void captureWorkflow()}
        >
          {saving ? 'Saving…' : graphReady ? 'Save workflow' : 'Loading graph…'}
        </button>
        <span className="hint" style={{ marginLeft: '0.35rem' }}>
          {props.hint}
        </span>
      </div>
      <webview
        ref={webviewRef as never}
        className="validation-webview"
        partition={partition}
        allowpopups={false as never}
      />
    </div>
  )
}
