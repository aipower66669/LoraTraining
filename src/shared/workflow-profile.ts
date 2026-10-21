/**
 * Shape of a single library-level captured ComfyUI workflow slot, shared between
 * the main-process store (`src/main/comfy/workflowStore.ts`) and the preload/
 * renderer layers that read it via IPC (e.g. to reload the correct graph into
 * the Edit Workflow webview — see `src/renderer/components/comfyWorkflowEditor.ts`).
 */
export type WorkflowGraph = Record<
  string,
  {
    class_type: string
    inputs: Record<string, unknown>
    _meta?: { title?: string }
  }
>

export interface WorkflowProfile {
  version: 1
  savedAt: string
  /** API-format graph (graphToPrompt().output) queued to /prompt. */
  workflow: WorkflowGraph
  /**
   * LiteGraph UI workflow (graphToPrompt().workflow) for extra_pnginfo.
   * Required by some save / metadata custom nodes.
   */
  uiWorkflow?: unknown
}

export function isWorkflowGraph(value: unknown): value is WorkflowGraph {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  for (const node of Object.values(value as Record<string, unknown>)) {
    if (!node || typeof node !== 'object') return false
    const n = node as Record<string, unknown>
    if (typeof n.class_type !== 'string' || !n.inputs || typeof n.inputs !== 'object') {
      return false
    }
  }
  return true
}

/** Minimal UI workflow stub so nodes expecting extra_pnginfo['workflow'] don't crash. */
export function emptyUiWorkflow(): Record<string, unknown> {
  return {
    nodes: [],
    links: [],
    groups: [],
    config: {},
    extra: {},
    version: 0.4
  }
}
