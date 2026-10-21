import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

function errorCode(err: unknown): string {
  return err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : ''
}

function isRetryableReplaceError(err: unknown): boolean {
  const code = errorCode(err)
  if (code === 'EPERM' || code === 'EEXIST' || code === 'EACCES' || code === 'EBUSY' || code === 'ENOENT') {
    return true
  }
  const msg = err instanceof Error ? err.message : String(err)
  return /busy|locked|EPERM|EACCES|EBUSY|EEXIST/i.test(msg)
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

/**
 * Atomic write: temp sibling → rename into place.
 * On Windows/SMB, rename-over often fails with EPERM/EBUSY; retry with backoff
 * and replace via unlink+rename (same pattern as shrink/convert).
 */
export async function atomicWriteFile(filePath: string, data: string | Buffer): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tmp = join(dirname(filePath), `.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`)
  await writeFile(tmp, data, typeof data === 'string' ? 'utf8' : undefined)

  let lastErr: unknown
  for (let attempt = 0; attempt < 10; attempt++) {
    if (attempt > 0) await sleep(25 * attempt * attempt)
    try {
      try {
        await rename(tmp, filePath)
        return
      } catch (err) {
        if (!isRetryableReplaceError(err)) throw err
        await unlink(filePath).catch(() => undefined)
        await rename(tmp, filePath)
        return
      }
    } catch (err) {
      lastErr = err
      if (!isRetryableReplaceError(err)) break
    }
  }

  await unlink(tmp).catch(() => undefined)
  throw lastErr instanceof Error
    ? lastErr
    : new Error(String(lastErr ?? `Could not write ${filePath}`))
}

export async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}
