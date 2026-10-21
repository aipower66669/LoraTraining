import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractFixedWorkflowModels } from '@shared/comfy-workflow-models'
import { isWorkflowGraph, type WorkflowProfile } from '@shared/workflow-profile'
import { LT_LIBRARY_WORKFLOW_FILES } from '@main/comfy/ltWorkflowTemplates'
import { resolveBundledWorkflowsDir } from '@main/comfy/bundledLtNodes'

describe('bundled Comfy workflows', () => {
  it('resolves resources/comfy-workflows with all shipped files', () => {
    const dir = resolveBundledWorkflowsDir()
    expect(dir).toBeTruthy()
    for (const f of LT_LIBRARY_WORKFLOW_FILES) {
      expect(existsSync(join(dir!, f.basename))).toBe(true)
    }
  })

  it('each bundled profile is a valid WorkflowProfile with a non-empty graph', () => {
    const dir = resolveBundledWorkflowsDir()!
    for (const f of LT_LIBRARY_WORKFLOW_FILES) {
      const profile = JSON.parse(readFileSync(join(dir, f.basename), 'utf8')) as WorkflowProfile
      expect(profile.version).toBe(1)
      expect(isWorkflowGraph(profile.workflow)).toBe(true)
      expect(Object.keys(profile.workflow).length).toBeGreaterThan(5)
    }
  })

  it('validation workflow has fixed CLIP + VAE (not empty LT-only stub)', () => {
    const dir = resolveBundledWorkflowsDir()!
    const profile = JSON.parse(
      readFileSync(join(dir, 'comfy-workflow-validation.json'), 'utf8')
    ) as WorkflowProfile
    const fixed = extractFixedWorkflowModels(profile.workflow).map((r) => r.filename)
    expect(fixed).toContain('qwen3vl_4b_fp8_scaled.safetensors')
    expect(fixed).toContain('Wan2_1_VAE_fp32.safetensors')
  })
})
