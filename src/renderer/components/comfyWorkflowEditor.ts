/**
 * Every Edit-Workflow pane (Validation, Upscale, …) uses a **dedicated**
 * `persist:comfyui-<tool>` webview partition (see `ComfyWorkflowEditPane`).
 * ComfyUI's frontend caches the last graph in that browser session — sharing one
 * partition across tools previously meant opening Validation could still show
 * Upscale's graph, and Save would overwrite the wrong library JSON file.
 * `loadWorkflowIntoComfyEditor` also force-loads the tool's saved graph (twice)
 * whenever the webview finishes loading.
 */

/** Minimal empty LiteGraph UI workflow, used to reset the editor for a tool that has no saved workflow yet. */
export const EMPTY_UI_WORKFLOW = {
  nodes: [],
  links: [],
  groups: [],
  config: {},
  extra: {},
  version: 0.4
}

/**
 * Load a saved UI-format ComfyUI workflow (or a blank graph, if `uiWorkflow` is
 * absent) into the live graph editor inside `wv`. Polls briefly for ComfyUI's
 * `window.app` to become available after navigation/reload before loading.
 */
export async function loadWorkflowIntoComfyEditor(
  wv: Electron.WebviewTag,
  uiWorkflow: unknown
): Promise<boolean> {
  const graph = uiWorkflow && typeof uiWorkflow === 'object' ? uiWorkflow : EMPTY_UI_WORKFLOW
  return wv.executeJavaScript(`
    (async () => {
      for (let i = 0; i < 50; i++) {
        if (window.app && window.app.loadGraphData) break
        await new Promise((r) => setTimeout(r, 100))
      }
      if (!window.app || !window.app.loadGraphData) return false
      await window.app.loadGraphData(${JSON.stringify(graph)}, true, true)
      return true
    })()
  `)
}
