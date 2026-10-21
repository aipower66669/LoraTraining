import { dirname, resolve } from 'node:path'
import { compareSemver, parseSemver, parseSetupInstallerName } from './local-update'

export const GITHUB_OWNER = 'aipower66669'
export const GITHUB_REPO = 'LoraTraining'

export const GITHUB_RELEASES_PAGE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`

export const GITHUB_LATEST_RELEASE_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`

export interface GithubInstallerAsset {
  name: string
  browser_download_url: string
}

export interface PickedGithubInstaller {
  fileName: string
  version: string
  downloadUrl: string
}

export interface AppReleaseNotes {
  version: string
  title: string
  markdown: string
  htmlUrl: string | null
  /** Tag used to resolve relative links, when the notes came from GitHub. */
  tag: string | null
}

/** `0.4.0` → `v0.4.0`, then the bare version. */
export function githubReleaseTagCandidates(version: string): string[] {
  const parsed = parseSemver(version)
  if (!parsed) {
    const bare = version.trim().replace(/^v/i, '')
    return bare ? [`v${bare}`] : []
  }
  const full = `${parsed[0]}.${parsed[1]}.${parsed[2]}`
  return [`v${full}`, full]
}

export function githubReleaseApiUrl(tag: string): string {
  return `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tags/${encodeURIComponent(tag)}`
}

export function githubReleaseNotesRawUrl(tag: string): string {
  return `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${encodeURIComponent(tag)}/RELEASE_NOTES.md`
}

/** Only the public GitHub release asset URL. Redirects after this are fine. */
export function isOfficialDownloadUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    if (parsed.username || parsed.password) return false
    return (
      parsed.hostname === 'github.com' &&
      parsed.pathname.startsWith(`/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/`)
    )
  } catch {
    return false
  }
}

/** Newest `LoraTraining Setup X.Y.Z.exe` asset whose URL is this repo’s release download. */
export function pickGithubInstaller(assets: GithubInstallerAsset[]): PickedGithubInstaller | null {
  let best: PickedGithubInstaller | null = null
  for (const asset of assets) {
    const name = asset.name?.trim()
    const downloadUrl = asset.browser_download_url?.trim()
    if (!name || !downloadUrl || !isOfficialDownloadUrl(downloadUrl)) continue
    const parsed = parseSetupInstallerName(name)
    if (!parsed) continue
    if (!best || compareSemver(parsed.version, best.version) > 0) {
      best = { fileName: parsed.fileName, version: parsed.version, downloadUrl }
    }
  }
  return best
}

/**
 * Folders that may hold `RELEASE_NOTES.md` for a local installer:
 * the update folder, then its parent (the repo when the folder is `release/`).
 */
export function localReleaseNotesSearchDirs(updateFolder: string): string[] {
  const folder = resolve(updateFolder.trim())
  const parent = dirname(folder)
  if (parent.toLowerCase() === folder.toLowerCase()) return [folder]
  return [folder, parent]
}

/**
 * Open http(s) links as-is. Relative doc links in release notes open the file
 * on the tag that produced the notes. Other schemes are dropped.
 */
export function resolveReleaseNotesHref(href: string, tag: string | null): string | null {
  const trimmed = href.trim()
  if (!trimmed || /^(javascript|data|vbscript):/i.test(trimmed)) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith('#') || !tag) return null
  const hashAt = trimmed.indexOf('#')
  const pathPart = (hashAt >= 0 ? trimmed.slice(0, hashAt) : trimmed).replace(/^\.\//, '')
  const hash = hashAt >= 0 ? trimmed.slice(hashAt) : ''
  if (!pathPart || pathPart.split('/').some((part) => part === '..' || part === '')) return null
  const encoded = pathPart.split('/').map((part) => encodeURIComponent(part)).join('/')
  return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/blob/${encodeURIComponent(tag)}/${encoded}${hash}`
}
