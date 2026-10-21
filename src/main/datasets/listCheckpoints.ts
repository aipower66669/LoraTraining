import { readdir, stat } from 'node:fs/promises'
import { basename, extname, join, relative } from 'node:path'
import {
  CHECKPOINT_SCAN_MAX_DEPTH,
  shouldSkipOutputSubtree
} from '@shared/output-checkpoint-scan'

export type CheckpointFileHit = {
  fileName: string
  relativePath: string
  fullPath: string
  sizeBytes: number
  mtimeMs: number
}

/**
 * List training LoRAs under `{dataset}/output` without walking AI Toolkit cache trees.
 * Depth 0–1 only; skips Set/Stress/Weight and cache/sample/log folders.
 */
export async function listCheckpointSafetensorsShallow(
  outputRoot: string
): Promise<CheckpointFileHit[]> {
  const out: CheckpointFileHit[] = []

  async function visit(dir: string, depth: number): Promise<void> {
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return
    }
    for (const name of entries) {
      const full = join(dir, name)
      let st
      try {
        st = await stat(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (depth >= CHECKPOINT_SCAN_MAX_DEPTH) continue
        if (shouldSkipOutputSubtree(name)) continue
        await visit(full, depth + 1)
        continue
      }
      if (!st.isFile() || extname(name).toLowerCase() !== '.safetensors') continue
      out.push({
        fileName: name,
        relativePath: relative(outputRoot, full).replace(/\\/g, '/'),
        fullPath: full,
        sizeBytes: st.size,
        mtimeMs: st.mtimeMs
      })
    }
  }

  await visit(outputRoot, 0)
  return out
}

export function checkpointStem(fileName: string): string {
  return basename(fileName, extname(fileName))
}
