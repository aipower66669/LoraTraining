/**
 * Helpers for discovering NSIS installers produced by electron-builder into
 * `release/` (`LoraTraining Setup ${version}.exe`).
 */

/** Matches electron-builder’s default Windows NSIS artifact name. */
export const SETUP_INSTALLER_RE =
  /^LoraTraining Setup (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.exe$/i

export type SemverTriple = readonly [number, number, number]

export function parseSemver(version: string): SemverTriple | null {
  const m = version
    .trim()
    .replace(/^v/i, '')
    .match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** Negative if a < b, 0 if equal (ignoring prerelease suffix), positive if a > b. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa || !pb) return 0
  for (let i = 0; i < 3; i++) {
    const d = pa[i]! - pb[i]!
    if (d !== 0) return d
  }
  return 0
}

export function parseSetupInstallerName(
  fileName: string
): { fileName: string; version: string } | null {
  const base = fileName.replace(/^.*[/\\]/, '')
  const m = base.match(SETUP_INSTALLER_RE)
  if (!m?.[1]) return null
  return { fileName: base, version: m[1] }
}

export function pickNewestInstaller(
  fileNames: string[]
): { fileName: string; version: string } | null {
  let best: { fileName: string; version: string } | null = null
  for (const name of fileNames) {
    const parsed = parseSetupInstallerName(name)
    if (!parsed) continue
    if (!best || compareSemver(parsed.version, best.version) > 0) {
      best = parsed
    }
  }
  return best
}

export type UpdateSource = 'folder' | 'github'

export interface LocalUpdateCheck {
  currentVersion: string
  latestVersion: string | null
  installerPath: string | null
  installerFileName: string | null
  /** GitHub asset URL when `source` is `github` and a Setup exe was found. */
  downloadUrl: string | null
  source: UpdateSource
  updateAvailable: boolean
  message: string
}
