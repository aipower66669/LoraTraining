import { randomInt } from 'node:crypto'
import { readFile, unlink } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import {
  extractIdentityName,
  hasIdentityTag,
  parseNamePool,
  parseUsedNamesFile,
  pickRandomUnusedName,
  serializeUsedNames,
  stripIdentityTag,
  upsertIdentityTag,
  type IdentityTagMode
} from '@shared/identity-tag'
import { identityNamesUsedPath } from '@shared/library-paths'
import { appError } from '@shared/errors'
import { atomicWriteFile } from '../security/atomic-write'
import { assertInsideRoot } from '../security/path-guards'
import { getDatasetRecord, scanFolder } from '../datasets/store'
import { resolveIdentityNamesPoolPath } from './identity-names-path'

export type ApplyIdentityTagsResult = {
  processed: number
  tagged: number
  skipped: number
  removed: number
  mode: IdentityTagMode
}

function captionPathFor(folderPath: string, fileName: string, captionExt: string): string {
  const stem = basename(fileName, extname(fileName))
  return join(folderPath, `${stem}.${captionExt}`)
}

async function loadCaptionText(capPath: string): Promise<string | null> {
  try {
    return await readFile(capPath, 'utf8')
  } catch {
    return null
  }
}

async function loadUsedNames(datasetFolder: string): Promise<Set<string>> {
  const path = identityNamesUsedPath(datasetFolder)
  try {
    const text = await readFile(path, 'utf8')
    return new Set(parseUsedNamesFile(text))
  } catch {
    return new Set()
  }
}

async function saveUsedNames(datasetFolder: string, used: Set<string>): Promise<void> {
  const path = assertInsideRoot(datasetFolder, identityNamesUsedPath(datasetFolder))
  const body = serializeUsedNames(used)
  await atomicWriteFile(path, body)
}

async function loadNamePool(): Promise<string[]> {
  const path = resolveIdentityNamesPoolPath()
  if (!path) {
    throw appError('tool-not-configured', 'Identity name pool (reference/names.txt) was not found', {
      remediation: 'Reinstall the app or ensure reference/names.txt is present next to the build.'
    })
  }
  const text = await readFile(path, 'utf8')
  const pool = parseNamePool(text)
  if (pool.length === 0) {
    throw appError('validation', 'Identity name pool is empty', {
      remediation: 'reference/names.txt must list one female given name per line.'
    })
  }
  return pool
}

function allocateName(pool: readonly string[], used: Set<string>): string {
  const name = pickRandomUnusedName(pool, used, () => randomInt(1_000_000_000) / 1_000_000_000)
  if (!name) {
    throw appError('validation', 'No unused identity names left for this dataset', {
      remediation:
        'Remove identity tags to free names, or add more names to reference/names.txt (pool is ~1000).'
    })
  }
  used.add(name)
  return name
}

/**
 * Apply identity tags across a dataset’s image captions.
 * Only mutates the `.photo of a girl named Name.` fragment.
 */
export async function applyIdentityTags(input: {
  datasetId: string
  mode: IdentityTagMode
}): Promise<ApplyIdentityTagsResult> {
  const mode = input.mode
  if (mode !== 'missing' && mode !== 'redo' && mode !== 'remove') {
    throw appError('validation', `Invalid identity tag mode: ${String(input.mode)}`)
  }

  const ds = await getDatasetRecord(input.datasetId)
  const { images } = await scanFolder(ds.folderPath, ds.captionExt)

  try {
    const { muteDatasetFolderWatch } = await import('../datasets/folderWatch')
    muteDatasetFolderWatch(Math.min(60_000, 1500 + images.length * 20))
  } catch {
    /* optional */
  }

  let tagged = 0
  let skipped = 0
  let removed = 0

  if (mode === 'remove') {
    for (const img of images) {
      const capPath = assertInsideRoot(
        ds.folderPath,
        captionPathFor(ds.folderPath, img.fileName, ds.captionExt)
      )
      const before = await loadCaptionText(capPath)
      if (before == null) continue
      if (!hasIdentityTag(before)) {
        skipped++
        continue
      }
      const after = stripIdentityTag(before)
      if (!after) {
        try {
          await unlink(capPath)
        } catch {
          await atomicWriteFile(capPath, '')
        }
      } else {
        await atomicWriteFile(capPath, after)
      }
      removed++
    }
    await saveUsedNames(ds.folderPath, new Set())
  } else {
    const pool = await loadNamePool()
    const used = mode === 'redo' ? new Set<string>() : await loadUsedNames(ds.folderPath)

    // Union names already present in captions so we never double-assign.
    if (mode === 'missing') {
      for (const img of images) {
        const capPath = assertInsideRoot(
          ds.folderPath,
          captionPathFor(ds.folderPath, img.fileName, ds.captionExt)
        )
        const text = await loadCaptionText(capPath)
        if (text == null) continue
        const existing = extractIdentityName(text)
        if (existing) used.add(existing)
      }
    }

    const assigned = new Set<string>()

    for (const img of images) {
      const capPath = assertInsideRoot(
        ds.folderPath,
        captionPathFor(ds.folderPath, img.fileName, ds.captionExt)
      )
      const before = await loadCaptionText(capPath)

      if (mode === 'missing') {
        if (before != null && hasIdentityTag(before)) {
          const existing = extractIdentityName(before)
          if (existing) assigned.add(existing)
          skipped++
          continue
        }
        const name = allocateName(pool, used)
        assigned.add(name)
        await atomicWriteFile(capPath, upsertIdentityTag(before ?? '', name))
        tagged++
        continue
      }

      // redo — free previous name for reassignment within this pass via fresh `used`
      const stripped = before == null ? '' : stripIdentityTag(before)
      const name = allocateName(pool, used)
      assigned.add(name)
      await atomicWriteFile(capPath, upsertIdentityTag(stripped, name))
      tagged++
    }

    await saveUsedNames(ds.folderPath, assigned)
  }

  try {
    const { rescanDataset } = await import('../datasets/store')
    await rescanDataset(input.datasetId)
  } catch {
    /* best-effort */
  }

  return {
    processed: images.length,
    tagged,
    skipped,
    removed,
    mode
  }
}
