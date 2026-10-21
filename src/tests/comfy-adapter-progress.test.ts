import { describe, expect, it } from 'vitest'
import { pickProgressStateNode } from '../main/comfy/comfyProgress'

describe('pickProgressStateNode', () => {
  it('prefers the running node with the largest max (sampler steps)', () => {
    const picked = pickProgressStateNode({
      '1': { state: 'finished', value: 1, max: 1, node_id: '1' },
      '12': { state: 'running', value: 0, max: 12, display_node_id: '12' },
      '3': { state: 'running', value: 0.5, max: 1, node_id: '3' }
    })
    expect(picked).toEqual({ nodeId: '12', value: 0, max: 12 })
  })

  it('returns null when nothing is running', () => {
    expect(
      pickProgressStateNode({
        '1': { state: 'pending', value: 0, max: 1 }
      })
    ).toBeNull()
  })
})
