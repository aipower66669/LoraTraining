import { readFile, mkdir, copyFile, access, readdir, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, join } from 'node:path'
import {
  WORKFLOW_BACKUPS_DIR,
  legacyLibraryUpscaleWorkflowPath,
  legacyLibraryValidationWorkflowPath,
  legacyLibraryWorkflowPath,
  libraryContextWorkflowPath,
  libraryExpressionWorkflowPath,
  libraryUpscaleWorkflowPath,
  libraryValidationWorkflowPath
} from '@shared/library-paths'
import {
  emptyUiWorkflow,
  isWorkflowGraph,
  type WorkflowGraph,
  type WorkflowProfile
} from '@shared/workflow-profile'
import { atomicWriteJson } from '../security/atomic-write'
import { getLibraryRoot } from '../settings/store'
import { logger } from '../logging'

export type { WorkflowGraph, WorkflowProfile }
export { emptyUiWorkflow, isWorkflowGraph }

/** Max timestamped copies under `!WorkflowBackups/<stem>/` (critical overwrite safety). */
const MAX_TIMESTAMPED_BACKUPS = 20

async function readProfile(path: string): Promise<WorkflowProfile | null> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as WorkflowProfile
    if (parsed?.version !== 1 || !isWorkflowGraph(parsed.workflow)) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * CRITICAL: never overwrite a workflow JSON without a recoverable prior copy.
 * All under `{libraryRoot}/!WorkflowBackups/{stem}/` (not library root):
 * - `last.bak` — last good (rotated to `last.bak.1`)
 * - `{iso}.json` — rolling history
 * Throws if an existing file cannot be backed up (blocks the save).
 */
async function backupExistingProfile(path: string, libraryRoot: string): Promise<void> {
  try {
    await access(path, constants.F_OK)
  } catch {
    return
  }

  const stem = basename(path).replace(/\.json$/i, '')
  const histDir = join(libraryRoot, WORKFLOW_BACKUPS_DIR, stem)
  const bak = join(histDir, 'last.bak')
  const bak1 = join(histDir, 'last.bak.1')

  try {
    await mkdir(histDir, { recursive: true })
  } catch (err) {
    throw new Error(
      `Refusing to overwrite workflow — could not create backup folder ${histDir}: ${
        err instanceof Error ? err.message : String(err)
      }`
    )
  }

  try {
    await access(bak, constants.F_OK)
    await copyFile(bak, bak1)
  } catch {
    /* no prior last.bak yet */
  }

  try {
    await copyFile(path, bak)
  } catch (err) {
    throw new Error(
      `Refusing to overwrite workflow — could not write safety backup ${bak}: ${
        err instanceof Error ? err.message : String(err)
      }`
    )
  }

  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    await copyFile(path, join(histDir, `${stamp}.json`))
    const entries = (await readdir(histDir))
      .filter((n) => n.toLowerCase().endsWith('.json'))
      .sort()
    const excess = entries.length - MAX_TIMESTAMPED_BACKUPS
    for (let i = 0; i < excess; i++) {
      const old = entries[i]
      if (!old) continue
      await unlink(join(histDir, old)).catch(() => undefined)
    }
  } catch (err) {
    // last.bak already written — log history failure but do not block save.
    logger.warn({ err, path, histDir }, 'workflow timestamped backup failed')
  }
}

/**
 * A single library-level captured ComfyUI workflow slot (one JSON file at
 * `{libraryRoot}/{fileName}`). Each tool (Validation, Upscale, …) gets its own
 * instance so they can each keep their own saved graph.
 */
export interface WorkflowStore {
  loadProfile(): Promise<WorkflowProfile | null>
  saveProfile(input: { workflow: unknown; uiWorkflow?: unknown }): Promise<WorkflowProfile>
}

function createWorkflowStore(
  pathFn: (libraryRoot: string) => string,
  legacyPathFns: Array<(libraryRoot: string) => string> = []
): WorkflowStore {
  return {
    async loadProfile(): Promise<WorkflowProfile | null> {
      const root = getLibraryRoot()
      const primary = await readProfile(pathFn(root))
      if (primary) return primary
      // Backward compat: read older pre-rename filenames, most recent first, if
      // the current one hasn't been migrated yet (see scripts/migrate-rename-*.ts).
      for (const legacyPathFn of legacyPathFns) {
        const legacy = await readProfile(legacyPathFn(root))
        if (legacy) return legacy
      }
      return null
    },
    async saveProfile(input: { workflow: unknown; uiWorkflow?: unknown }): Promise<WorkflowProfile> {
      if (!isWorkflowGraph(input.workflow)) {
        throw new Error('Invalid ComfyUI API workflow (expected graphToPrompt().output).')
      }
      const root = getLibraryRoot()
      await mkdir(root, { recursive: true })
      const path = pathFn(root)
      await backupExistingProfile(path, root)
      const profile: WorkflowProfile = {
        version: 1,
        savedAt: new Date().toISOString(),
        workflow: input.workflow,
        uiWorkflow:
          input.uiWorkflow && typeof input.uiWorkflow === 'object'
            ? input.uiWorkflow
            : emptyUiWorkflow()
      }
      await atomicWriteJson(path, profile)
      return profile
    }
  }
}

export const validationWorkflowStore = createWorkflowStore(libraryValidationWorkflowPath, [
  legacyLibraryValidationWorkflowPath,
  legacyLibraryWorkflowPath
])

export const upscaleWorkflowStore = createWorkflowStore(libraryUpscaleWorkflowPath, [
  legacyLibraryUpscaleWorkflowPath
])

export const contextWorkflowStore = createWorkflowStore(libraryContextWorkflowPath)
export const expressionWorkflowStore = createWorkflowStore(libraryExpressionWorkflowPath)

/** @deprecated Use `validationWorkflowStore.loadProfile()`. Kept for existing call sites. */
export function loadWorkflowProfile(): Promise<WorkflowProfile | null> {
  return validationWorkflowStore.loadProfile()
}

/** @deprecated Use `validationWorkflowStore.saveProfile()`. Kept for existing call sites. */
export function saveWorkflowProfile(input: {
  workflow: unknown
  uiWorkflow?: unknown
}): Promise<WorkflowProfile> {
  return validationWorkflowStore.saveProfile(input)
}
