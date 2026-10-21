import { describe, expect, it } from 'vitest'
import {
  inferComfyRootFromLorasFolder,
  ltNodesInstallPath,
  LT_COMFY_NODES_DIR
} from '@shared/comfy-install'

describe('comfy-install', () => {
  it('infers Comfy root from models/loras path', () => {
    expect(inferComfyRootFromLorasFolder('F:\\AI\\ComfyUI\\models\\loras')).toBe('F:/AI/ComfyUI')
    expect(inferComfyRootFromLorasFolder('F:/AI/ComfyUI/models/loras/')).toBe('F:/AI/ComfyUI')
    expect(inferComfyRootFromLorasFolder('F:/AI/ComfyUI/models/loras/extra')).toBeNull()
    expect(inferComfyRootFromLorasFolder('')).toBeNull()
    expect(inferComfyRootFromLorasFolder('   ')).toBeNull()
  })

  it('builds install path under custom_nodes', () => {
    expect(ltNodesInstallPath('F:/ComfyUI')).toBe(
      `F:\\ComfyUI\\custom_nodes\\${LT_COMFY_NODES_DIR}`
    )
    expect(ltNodesInstallPath('F:/ComfyUI/')).toBe(
      `F:\\ComfyUI\\custom_nodes\\${LT_COMFY_NODES_DIR}`
    )
  })
})
