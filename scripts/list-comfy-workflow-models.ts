#!/usr/bin/env tsx
/**
 * Print fixed (non–LT-inject) model filenames from library Comfy workflow JSON.
 * Usage: npm run list:comfy-models
 *        npm run list:comfy-models -- --library "D:\LoRA-Library"
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  dedupeFixedWorkflowModels,
  extractFixedWorkflowModels
} from '../src/shared/comfy-workflow-models'
import type { WorkflowProfile } from '../src/shared/workflow-profile'
import { resolveLibraryRoot } from './lib/library-root'

const WORKFLOW_FILES = [
  'comfy-workflow-validation.json',
  'comfy-workflow-upscale.json',
  'comfy-workflow-context.json',
  'comfy-workflow-expression.json'
] as const

async function main(): Promise<void> {
  const libArg = process.argv.indexOf('--library')
  const override = libArg >= 0 ? process.argv[libArg + 1] : undefined
  const root = override?.trim() || (await resolveLibraryRoot())
  if (!root) {
    console.error('Library root is not configured. Set app-config.json or pass --library.')
    process.exit(1)
  }

  for (const basename of WORKFLOW_FILES) {
    const path = join(root, basename)
    let profile: WorkflowProfile
    try {
      profile = JSON.parse(await readFile(path, 'utf8')) as WorkflowProfile
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.log(`\n=== ${basename} ===\n(missing or unreadable: ${message})`)
      continue
    }
    const fixed = dedupeFixedWorkflowModels(extractFixedWorkflowModels(profile.workflow))
    console.log(`\n=== ${basename} ===`)
    if (fixed.length === 0) {
      console.log('(no fixed model filenames — only LT inject nodes or node references)')
      continue
    }
    for (const ref of fixed) {
      console.log(`${ref.filename}\t${ref.classType}\t${ref.inputKey}\tnode ${ref.nodeId}`)
    }
  }
}

void main().catch((err) => {
  console.error(err)
  process.exit(1)
})
