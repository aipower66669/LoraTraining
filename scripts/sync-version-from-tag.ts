/**
 * CI release helper: sync package.json / package-lock.json version from git tag.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { versionFromReleaseTag } from '../src/shared/release-tag'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgPath = join(root, 'package.json')
const lockPath = join(root, 'package-lock.json')

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export function syncVersionFromTag(tag: string): string {
  const version = versionFromReleaseTag(tag)
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }
  const prev = pkg.version
  pkg.version = version
  writeJson(pkgPath, pkg)

  if (existsSync(lockPath)) {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as {
      version: string
      packages?: Record<string, { version?: string }>
    }
    lock.version = version
    if (lock.packages?.['']) {
      lock.packages[''].version = version
    }
    writeJson(lockPath, lock)
  }

  console.log(`[sync-version-from-tag] ${prev} → ${version} (tag ${tag})`)
  return version
}

const tag = process.env.GITHUB_REF_NAME || process.argv[2]
if (!tag) {
  console.error('[sync-version-from-tag] Pass tag as GITHUB_REF_NAME or argv[2]')
  process.exit(1)
}
try {
  syncVersionFromTag(tag)
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
