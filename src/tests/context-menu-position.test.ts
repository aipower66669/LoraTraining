import { afterEach, describe, expect, it, vi } from 'vitest'
import { clampContextMenuPosition } from '../renderer/util/contextMenuPosition'

describe('clampContextMenuPosition', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the menu inside the viewport near the bottom-right', () => {
    vi.stubGlobal('window', { innerWidth: 1000, innerHeight: 800 })
    const pos = clampContextMenuPosition(950, 750, 200, 300)
    expect(pos.x).toBe(1000 - 200 - 8)
    expect(pos.y).toBe(800 - 300 - 8)
  })

  it('does not move a menu that already fits', () => {
    vi.stubGlobal('window', { innerWidth: 1000, innerHeight: 800 })
    const pos = clampContextMenuPosition(100, 120, 180, 200)
    expect(pos).toEqual({ x: 100, y: 120 })
  })
})
