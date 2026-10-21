import { access, cp, mkdir, readFile } from 'node:fs/promises'
import { constants, existsSync } from 'node:fs'
import { join } from 'node:path'
import { appError } from '@shared/errors'
import {
  inferComfyRootFromLorasFolder,
  LT_COMFY_NODES_DIR,
  type InstallLtComfyNodesResult,
  type LtComfyNodesStatus,
  type SeedLtWorkflowsResult
} from '@shared/comfy-install'
import { isWorkflowGraph, type WorkflowProfile } from '@shared/workflow-profile'
import { atomicWriteJson } from '../security/atomic-write'
import { getLibraryRoot, loadSettings } from '../settings/store'
import {
  LT_BUNDLED_WORKFLOW_DIR,
  LT_LIBRARY_WORKFLOW_FILES
} from './ltWorkflowTemplates'

const MARKER_FILES = ['__init__.py', 'nodes.py'] as const

function resourceCandidates(subdir: string): string[] {
  const candidates: string[] = []
  try {
    if (typeof process.resourcesPath === 'string' && process.resourcesPath) {
      candidates.push(join(process.resourcesPath, subdir))
    }
  } catch {
    /* ignore */
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron')
    if (app?.getAppPath) {
      candidates.push(join(app.getAppPath(), 'resources', subdir))
      candidates.push(join(app.getAppPath(), subdir))
    }
  } catch {
    /* not in electron */
  }
  candidates.push(join(__dirname, '../../../resources', subdir))
  candidates.push(join(process.cwd(), 'resources', subdir))
  candidates.push(join(process.cwd(), subdir))
  return candidates
}

/** Directory containing the shipped `comfyui-lora-training` package. */
export function resolveBundledLtNodesDir(): string | null {
  const candidates = [
    ...resourceCandidates(LT_COMFY_NODES_DIR),
    join(__dirname, '../../../comfyui-lora-training'),
    join(process.cwd(), LT_COMFY_NODES_DIR)
  ]
  for (const dir of candidates) {
    if (MARKER_FILES.every((name) => existsSync(join(dir, name)))) {
      return dir
    }
  }
  return null
}

/**
 * Directory with the shipped working Krea 2 workflow profiles
 * (`comfy-workflow-*.json`).
 */
export function resolveBundledWorkflowsDir(): string | null {
  for (const dir of resourceCandidates(LT_BUNDLED_WORKFLOW_DIR)) {
    if (
      LT_LIBRARY_WORKFLOW_FILES.every((f) => existsSync(join(dir, f.basename)))
    ) {
      return dir
    }
  }
  return null
}

export function resolveComfyRoot(explicit?: string | null): string | null {
  const direct = explicit?.trim()
  if (direct) return direct
  return null
}

export async function resolveComfyRootFromSettings(
  explicit?: string | null
): Promise<string | null> {
  const direct = resolveComfyRoot(explicit)
  if (direct) return direct
  const settings = await loadSettings()
  const fromSetting = settings.comfy.comfyRoot?.trim()
  if (fromSetting) return fromSetting
  return inferComfyRootFromLorasFolder(settings.comfy.lorasFolder)
}

export async function getLtComfyNodesStatus(
  explicitComfyRoot?: string | null
): Promise<LtComfyNodesStatus> {
  const bundlePath = resolveBundledLtNodesDir()
  const comfyRoot = await resolveComfyRootFromSettings(explicitComfyRoot)
  const installPath = comfyRoot
    ? join(comfyRoot, 'custom_nodes', LT_COMFY_NODES_DIR)
    : null
  let installed = false
  if (installPath) {
    try {
      for (const name of MARKER_FILES) {
        await access(join(installPath, name), constants.F_OK)
      }
      installed = true
    } catch {
      installed = false
    }
  }
  return {
    bundleFound: bundlePath != null,
    bundlePath,
    comfyRoot,
    installPath,
    installed
  }
}

async function copyBundledNodes(installPath: string, bundlePath: string): Promise<boolean> {
  await mkdir(installPath, { recursive: true })
  let changed = false
  for (const name of MARKER_FILES) {
    const src = join(bundlePath, name)
    const dest = join(installPath, name)
    const prev = await readFileIfExists(dest)
    const next = await readFile(src)
    if (!prev || !prev.equals(next)) {
      await cp(src, dest, { force: true })
      changed = true
    }
  }
  const readmeSrc = join(bundlePath, 'README.md')
  try {
    await access(readmeSrc, constants.F_OK)
    const dest = join(installPath, 'README.md')
    const prev = await readFileIfExists(dest)
    const next = await readFile(readmeSrc)
    if (!prev || !prev.equals(next)) {
      await cp(readmeSrc, dest, { force: true })
      changed = true
    }
  } catch {
    /* optional */
  }
  return changed
}

async function readFileIfExists(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path)
  } catch {
    return null
  }
}

async function loadBundledWorkflowProfile(
  bundleDir: string,
  basename: string
): Promise<WorkflowProfile> {
  const raw = await readFile(join(bundleDir, basename), 'utf8')
  const parsed = JSON.parse(raw) as WorkflowProfile
  if (parsed?.version !== 1 || !isWorkflowGraph(parsed.workflow)) {
    throw appError('validation', `Bundled workflow is invalid: ${basename}`, {
      remediation: 'Reinstall LoraTraining or restore resources/comfy-workflows/ from the repo.'
    })
  }
  return parsed
}

/**
 * Copy shipped working Comfy graphs into the library when missing.
 * Never overwrites an existing `comfy-workflow-*.json`.
 */
export async function seedLtLibraryWorkflows(): Promise<SeedLtWorkflowsResult> {
  const bundleDir = resolveBundledWorkflowsDir()
  if (!bundleDir) {
    throw appError('not-found', 'Bundled Comfy workflows were not found in this install', {
      remediation:
        'Reinstall LoraTraining or run from a checkout that includes resources/comfy-workflows/.'
    })
  }
  const root = getLibraryRoot()
  await mkdir(root, { recursive: true })
  const created: string[] = []
  const skipped: string[] = []
  for (const file of LT_LIBRARY_WORKFLOW_FILES) {
    const path = join(root, file.basename)
    try {
      await access(path, constants.F_OK)
      skipped.push(file.basename)
      continue
    } catch {
      /* missing — seed bundled working graph */
    }
    const profile = await loadBundledWorkflowProfile(bundleDir, file.basename)
    await atomicWriteJson(path, profile)
    created.push(file.basename)
  }
  return { created, skipped }
}

export async function installLtComfyPackage(opts?: {
  comfyRoot?: string | null
  seedWorkflows?: boolean
}): Promise<InstallLtComfyNodesResult> {
  const bundlePath = resolveBundledLtNodesDir()
  if (!bundlePath) {
    throw appError('not-found', 'Bundled LT Comfy custom nodes were not found in this install', {
      remediation: 'Reinstall LoraTraining or run from a dev checkout that includes comfyui-lora-training/.'
    })
  }
  const comfyRoot = await resolveComfyRootFromSettings(opts?.comfyRoot)
  if (!comfyRoot) {
    throw appError('validation', 'ComfyUI root is not set', {
      remediation:
        'Set Settings → ComfyUI → ComfyUI root, or set LoRAs to …/models/loras so the root can be inferred.'
    })
  }
  const installPath = join(comfyRoot, 'custom_nodes', LT_COMFY_NODES_DIR)
  const updated = await copyBundledNodes(installPath, bundlePath)
  let workflowsSeeded: string[] = []
  if (opts?.seedWorkflows !== false) {
    try {
      const seeded = await seedLtLibraryWorkflows()
      workflowsSeeded = seeded.created
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!message.includes('Library root is not configured')) {
        throw err
      }
    }
  }
  return {
    comfyRoot,
    installPath,
    updated,
    workflowsSeeded
  }
}

/** Human-readable list of workflow files this feature manages. */
export function ltWorkflowBasenames(): string[] {
  return LT_LIBRARY_WORKFLOW_FILES.map((t) => t.basename)
}

export function ltWorkflowHint(basename: string): string | undefined {
  return LT_LIBRARY_WORKFLOW_FILES.find((t) => t.basename === basename)?.hint
}
