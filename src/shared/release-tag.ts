/**
 * Map git release tag `vX.Y.Z` → semver `X.Y.Z`.
 * Tags must include the patch segment (e.g. `v0.3.0`, not `v0.3`).
 */
export function versionFromReleaseTag(tag: string): string {
  const raw = String(tag ?? '').trim()
  const m = raw.match(/^v(\d+)\.(\d+)\.(\d+)$/)
  if (!m) {
    throw new Error(`Invalid release tag "${raw}" — use vX.Y.Z (e.g. v0.3.0)`)
  }
  return `${m[1]}.${m[2]}.${m[3]}`
}
