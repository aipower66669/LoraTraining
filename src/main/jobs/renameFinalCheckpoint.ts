import { readdir, rename, stat } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { planFinalCheckpointRename } from '@shared/checkpoints'
import { logger } from '../logging'

const SIDE_EXTS = new Set([
  '.safetensors',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.bmp',
  '.json',
  '.yaml',
  '.yml',
  '.txt'
])

async function listFilesRecursive(root: string): Promise<string[]> {
  const out: string[] = []
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      const full = join(dir, name)
      let st
      try {
        st = await stat(full)
      } catch {
        continue
      }
      if (st.isDirectory()) stack.push(full)
      else if (st.isFile()) out.push(full)
    }
  }
  return out
}

export interface FinalCheckpointRenameResult {
  renamed: Array<{ from: string; to: string }>
  skippedReason?: string
}

/**
 * After a successful train: rename `{loraName}.safetensors` → `{loraName}_{steps}.safetensors`
 * (and matching sidecars) under `trainingFolder`.
 */
export async function renameFinalCheckpoint(opts: {
  trainingFolder: string
  loraName: string
  totalSteps: number
}): Promise<FinalCheckpointRenameResult> {
  const files = await listFilesRecursive(opts.trainingFolder)
  const finals = files.filter((full) => {
    const stem = basename(full, extname(full))
    return stem === opts.loraName && extname(full).toLowerCase() === '.safetensors'
  })

  if (finals.length === 0) {
    return { renamed: [], skippedReason: 'No unnumbered final checkpoint found' }
  }

  const renamed: Array<{ from: string; to: string }> = []

  for (const finalPath of finals) {
    const dir = dirname(finalPath)
    let siblings: string[]
    try {
      siblings = await readdir(dir)
    } catch (err) {
      logger.warn({ err, dir }, 'final checkpoint rename: cannot read dir')
      continue
    }

    const plan = planFinalCheckpointRename({
      loraName: opts.loraName,
      totalSteps: opts.totalSteps,
      fileNames: siblings
    })
    if (!plan) {
      return {
        renamed,
        skippedReason: `Target already exists or steps invalid for ${opts.loraName}`
      }
    }

    for (const name of siblings) {
      const ext = extname(name)
      const stem = basename(name, ext)
      if (stem !== plan.fromStem) continue
      if (!SIDE_EXTS.has(ext.toLowerCase())) continue
      const from = join(dir, name)
      const to = join(dir, `${plan.toStem}${ext}`)
      try {
        await rename(from, to)
        renamed.push({ from, to })
      } catch (err) {
        logger.warn({ err, from, to }, 'final checkpoint rename failed')
      }
    }
  }

  return { renamed }
}
