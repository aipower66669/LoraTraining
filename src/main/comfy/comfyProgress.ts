import { formatComfyProgressLine } from '@shared/comfy-progress'
import type { WorkflowGraph } from './workflowStore'

export { formatComfyProgressLine }

/** Pick the best running node from a ComfyUI progress_state payload. */
export function pickProgressStateNode(
  nodes: Record<string, unknown> | null | undefined
): { nodeId: string; value: number; max: number } | null {
  if (!nodes || typeof nodes !== 'object') return null
  let best: { nodeId: string; value: number; max: number } | null = null
  for (const [id, raw] of Object.entries(nodes)) {
    if (!raw || typeof raw !== 'object') continue
    const n = raw as Record<string, unknown>
    const state = String(n['state'] ?? '')
    if (state !== 'running') continue
    const value = Number(n['value'])
    const max = Number(n['max'])
    if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) continue
    const nodeId = String(n['display_node_id'] ?? n['real_node_id'] ?? n['node_id'] ?? id)
    if (!best || max > best.max) {
      best = { nodeId, value, max }
    }
  }
  return best
}

/** Prefer node _meta.title, else class_type. */
export function resolveWorkflowNodeTitle(
  workflow: WorkflowGraph | null | undefined,
  nodeId: string | null | undefined
): string | null {
  if (!workflow || nodeId == null || nodeId === '') return null
  const node = workflow[nodeId]
  if (!node) return null
  const title = node._meta?.title?.trim()
  if (title) return title
  return node.class_type || null
}
