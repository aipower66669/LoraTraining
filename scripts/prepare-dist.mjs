/**
 * Pre-flight for `npm run dist`:
 * 1. Bump package.json / package-lock.json patch (X.Y.Z → X.Y.Z+1)
 * 2. Wipe `release/` so only the new installer remains after electron-builder
 *
 * Skip the bump with `--no-bump` or SKIP_VERSION_BUMP=1 (still cleans release/).
 * Skip the clean with SKIP_RELEASE_CLEAN=1.
 */
import { rmSync, readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgPath = join(root, 'package.json')
const lockPath = join(root, 'package-lock.json')
const releaseDir = join(root, 'release')
const releaseReadmeSrc = join(root, 'resources', 'release-README.md')
const releaseReadmeDest = join(releaseDir, 'README.md')

function bumpPatch(version) {
  const m = String(version).trim().match(/^(\d+)\.(\d+)\.(\d+)(.*)?$/)
  if (!m) {
    throw new Error(`Cannot bump non-semver version: ${version}`)
  }
  const major = Number(m[1])
  const minor = Number(m[2])
  const patch = Number(m[3]) + 1
  const suffix = m[4] ?? ''
  return `${major}.${minor}.${patch}${suffix}`
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const readmeOnly = process.argv.includes('--readme-only')
const skipBump =
  readmeOnly || process.argv.includes('--no-bump') || process.env.SKIP_VERSION_BUMP === '1'
const skipClean = readmeOnly || process.env.SKIP_RELEASE_CLEAN === '1'

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const prev = pkg.version
let next = prev

if (!skipBump) {
  next = bumpPatch(prev)
  pkg.version = next
  writeJson(pkgPath, pkg)

  if (existsSync(lockPath)) {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
    lock.version = next
    if (lock.packages?.['']) {
      lock.packages[''].version = next
    }
    writeJson(lockPath, lock)
  }
  console.log(`[prepare-dist] version ${prev} → ${next}`)
} else if (!readmeOnly) {
  const why = process.argv.includes('--no-bump') ? '--no-bump' : 'SKIP_VERSION_BUMP=1'
  console.log(`[prepare-dist] ${why} — keeping ${prev}`)
}

if (!skipClean) {
  if (existsSync(releaseDir)) {
    rmSync(releaseDir, { recursive: true, force: true })
    console.log(`[prepare-dist] cleared ${releaseDir}`)
  } else {
    console.log(`[prepare-dist] release/ already absent`)
  }
} else if (!readmeOnly) {
  console.log(`[prepare-dist] SKIP_RELEASE_CLEAN=1 — keeping release/`)
}

// Sharing-service readme. The clean above removes release/, and electron-builder
// does not emit this file, so copy it back next to the installer.
if (!existsSync(releaseReadmeSrc)) {
  throw new Error(`Missing sharing readme: ${releaseReadmeSrc}`)
}
mkdirSync(releaseDir, { recursive: true })
copyFileSync(releaseReadmeSrc, releaseReadmeDest)
console.log(`[prepare-dist] wrote ${releaseReadmeDest}`)
