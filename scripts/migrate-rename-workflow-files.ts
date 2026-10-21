/**
 * IN-PLACE migration: rename library workflow files to the `comfy-workflow-<tool>.json`
 * naming scheme (tool name as a suffix, not a prefix), and seed the Upscale tool's
 * workflow slot from a copy of Validation's — the Upscale tool shares most of the
 * same LT contract nodes, so its saved graph is a reasonable starting point rather
 * than making the user build one from scratch.
 *
 * Steps:
 *  1. Rename `{libraryRoot}/validation-comfy-workflow.json` → `comfy-workflow-validation.json`
 *     (falling back to the older `comfy-workflow.json` if that's what's still on disk).
 *  2. Rename `{libraryRoot}/upscale-comfy-workflow.json` → `comfy-workflow-upscale.json`
 *     if present; otherwise, copy the (now-renamed) validation workflow to
 *     `comfy-workflow-upscale.json` as a starting point.
 *
 * Idempotent: no-ops any step whose destination already exists.
 * The app itself also falls back to reading the older filenames if this script
 * hasn't been run yet (see `src/main/comfy/workflowStore.ts`), so this is a
 * one-time tidy-up, not a hard requirement for the app to keep working.
 *
 * Usage: npm run migrate:rename-workflow-files
 *    or: npx tsx scripts/migrate-rename-workflow-files.ts [--dry-run]
 */
import { access, copyFile, mkdir, rename, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import {
  LEGACY_LIBRARY_UPSCALE_WORKFLOW_FILE,
  LEGACY_LIBRARY_VALIDATION_WORKFLOW_FILE,
  LEGACY_LIBRARY_WORKFLOW_FILE,
  LIBRARY_UPSCALE_WORKFLOW_FILE,
  LIBRARY_VALIDATION_WORKFLOW_FILE
} from '../src/shared/library-paths'
import { resolveLibraryRoot } from './lib/library-root'

const DRY_RUN = process.argv.includes('--dry-run')

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function moveFileBestEffort(from: string, to: string): Promise<void> {
  try {
    await rename(from, to)
  } catch {
    await copyFile(from, to)
    await unlink(from).catch(() => undefined)
  }
}

async function main(): Promise<void> {
  const root = await resolveLibraryRoot()
  console.log('Library root:', root)
  console.log('Dry run:     ', DRY_RUN)

  if (!DRY_RUN) await mkdir(root, { recursive: true })

  // 1. Rename the validation workflow to the new suffix-style filename.
  const newValidationPath = join(root, LIBRARY_VALIDATION_WORKFLOW_FILE)
  const oneRenameAgoPath = join(root, LEGACY_LIBRARY_VALIDATION_WORKFLOW_FILE)
  const twoRenamesAgoPath = join(root, LEGACY_LIBRARY_WORKFLOW_FILE)

  // Tracks whether newValidationPath will exist once step 1 actually runs, so
  // step 2's dry-run reporting reflects the plan rather than the not-yet-applied disk state.
  let validationWillExist = await pathExists(newValidationPath)

  if (validationWillExist) {
    console.log(`[skip] Library already has ${LIBRARY_VALIDATION_WORKFLOW_FILE}.`)
  } else if (await pathExists(oneRenameAgoPath)) {
    console.log(`[rename] ${LEGACY_LIBRARY_VALIDATION_WORKFLOW_FILE} → ${LIBRARY_VALIDATION_WORKFLOW_FILE}`)
    if (!DRY_RUN) await moveFileBestEffort(oneRenameAgoPath, newValidationPath)
    validationWillExist = true
  } else if (await pathExists(twoRenamesAgoPath)) {
    console.log(`[rename] ${LEGACY_LIBRARY_WORKFLOW_FILE} → ${LIBRARY_VALIDATION_WORKFLOW_FILE}`)
    if (!DRY_RUN) await moveFileBestEffort(twoRenamesAgoPath, newValidationPath)
    validationWillExist = true
  } else {
    console.log('[skip] No existing validation workflow file found — nothing to rename.')
  }

  // 2. Rename (or seed from validation) the upscale workflow's new suffix-style filename.
  const newUpscalePath = join(root, LIBRARY_UPSCALE_WORKFLOW_FILE)
  const legacyUpscalePath = join(root, LEGACY_LIBRARY_UPSCALE_WORKFLOW_FILE)

  if (await pathExists(newUpscalePath)) {
    console.log(`[skip] Library already has ${LIBRARY_UPSCALE_WORKFLOW_FILE}.`)
  } else if (await pathExists(legacyUpscalePath)) {
    console.log(`[rename] ${LEGACY_LIBRARY_UPSCALE_WORKFLOW_FILE} → ${LIBRARY_UPSCALE_WORKFLOW_FILE}`)
    if (!DRY_RUN) await moveFileBestEffort(legacyUpscalePath, newUpscalePath)
  } else if (validationWillExist) {
    console.log(`[copy] ${LIBRARY_VALIDATION_WORKFLOW_FILE} → ${LIBRARY_UPSCALE_WORKFLOW_FILE} (starting point for Upscale)`)
    if (!DRY_RUN) await copyFile(newValidationPath, newUpscalePath)
  } else {
    console.log('[skip] No validation workflow to seed the upscale workflow from either.')
  }

  console.log('Done.')
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
