import WebSocket from 'ws'
import {
  comfyHttpBase,
  comfyWsUrl,
  formatComfyConnectError,
  type ComfyConnectionSettings
} from '@shared/comfy'
import { pickProgressStateNode } from './comfyProgress'

export type ExecutionEvent =
  | { type: 'execution_error'; promptId: string; message: string }
  | { type: 'executed'; promptId: string }
  | { type: 'executing'; promptId: string; nodeId: string | null }
  | {
      type: 'progress'
      promptId: string
      value: number
      max: number
      nodeId?: string | null
    }
  | { type: 'progress_text'; promptId: string; text: string; nodeId?: string | null }
  | {
      type: 'progress_state'
      promptId: string
      value: number
      max: number
      nodeId: string | null
    }
  | { type: 'other' }

export class ComfyAdapter {
  constructor(private readonly connection: ComfyConnectionSettings) {}

  private base(): string {
    return comfyHttpBase(this.connection)
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await fetch(`${this.base()}/system_stats`, {
        signal: AbortSignal.timeout(5000)
      })
      if (!res.ok) {
        return {
          ok: false,
          message: `ComfyUI responded with HTTP ${res.status} at ${this.base()}`
        }
      }
      return { ok: true, message: `Reachable at ${this.base()}` }
    } catch (err) {
      return {
        ok: false,
        message: formatComfyConnectError(this.connection, err)
      }
    }
  }

  async queuePrompt(
    workflow: Record<string, unknown>,
    clientId: string,
    opts?: { uiWorkflow?: unknown }
  ): Promise<{ promptId: string }> {
    const uiWorkflow =
      opts?.uiWorkflow && typeof opts.uiWorkflow === 'object'
        ? opts.uiWorkflow
        : { nodes: [], links: [], groups: [], config: {}, extra: {}, version: 0.4 }

    let res: Response
    try {
      res = await fetch(`${this.base()}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: workflow,
          client_id: clientId,
          // Many save / metadata nodes require this (UI queues always send it).
          extra_data: {
            extra_pnginfo: {
              workflow: uiWorkflow
            }
          }
        })
      })
    } catch (err) {
      throw new Error(formatComfyConnectError(this.connection, err))
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(
        `ComfyUI rejected prompt at ${this.base()} (HTTP ${res.status}): ${text.slice(0, 400)}`
      )
    }
    const json = (await res.json()) as { prompt_id?: string }
    if (!json.prompt_id) throw new Error(`ComfyUI returned no prompt_id (${this.base()})`)
    return { promptId: json.prompt_id }
  }

  async getHistory(promptId: string): Promise<Record<string, unknown> | null> {
    let res: Response
    try {
      res = await fetch(`${this.base()}/history/${encodeURIComponent(promptId)}`)
    } catch {
      return null
    }
    if (!res.ok) return null
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return (json[promptId] as Record<string, unknown>) ?? null
  }

  async interrupt(): Promise<void> {
    await fetch(`${this.base()}/interrupt`, { method: 'POST' }).catch(() => undefined)
  }

  monitor(clientId: string, onEvent: (event: ExecutionEvent) => void): () => void {
    const ws = new WebSocket(comfyWsUrl(this.connection, clientId))
    ws.on('message', (raw, isBinary) => {
      if (isBinary) return
      try {
        const msg = JSON.parse(raw.toString()) as {
          type: string
          data?: Record<string, unknown>
        }
        const d = msg.data ?? {}
        const promptId = String(d['prompt_id'] ?? '')
        if (msg.type === 'execution_error') {
          onEvent({
            type: 'execution_error',
            promptId,
            message: String(d['exception_message'] ?? d['message'] ?? 'Execution error')
          })
        } else if (msg.type === 'executed') {
          onEvent({ type: 'executed', promptId })
        } else if (msg.type === 'executing') {
          const node = d['node']
          onEvent({
            type: 'executing',
            promptId,
            nodeId: node == null || node === '' ? null : String(node)
          })
        } else if (msg.type === 'progress') {
          const value = Number(d['value'])
          const max = Number(d['max'])
          if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) {
            onEvent({ type: 'other' })
            return
          }
          const node = d['node']
          onEvent({
            type: 'progress',
            promptId,
            value,
            max,
            nodeId: node == null || node === '' ? null : String(node)
          })
        } else if (msg.type === 'progress_text') {
          const text = String(d['text'] ?? d['message'] ?? '').trim()
          if (!text) {
            onEvent({ type: 'other' })
            return
          }
          const node = d['node'] ?? d['node_id']
          onEvent({
            type: 'progress_text',
            promptId,
            text,
            nodeId: node == null || node === '' ? null : String(node)
          })
        } else if (msg.type === 'progress_state') {
          const picked = pickProgressStateNode(d['nodes'] as Record<string, unknown> | undefined)
          if (!picked) {
            onEvent({ type: 'other' })
            return
          }
          onEvent({
            type: 'progress_state',
            promptId,
            value: picked.value,
            max: picked.max,
            nodeId: picked.nodeId
          })
        } else {
          onEvent({ type: 'other' })
        }
      } catch {
        onEvent({ type: 'other' })
      }
    })
    return () => {
      try {
        ws.close()
      } catch {
        /* noop */
      }
    }
  }
}
