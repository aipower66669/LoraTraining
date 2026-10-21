import { spawn } from 'node:child_process'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { readdir } from 'node:fs/promises'
import { once } from 'node:events'
import { dirname, join, resolve } from 'node:path'
import { app, shell } from 'electron'
import { appError } from '@shared/errors'
import {
  GITHUB_LATEST_RELEASE_API,
  GITHUB_OWNER,
  GITHUB_REPO,
  githubReleaseApiUrl,
  githubReleaseNotesRawUrl,
  githubReleaseTagCandidates,
  isOfficialDownloadUrl,
  pickGithubInstaller,
  type AppReleaseNotes,
  type GithubInstallerAsset
} from '@shared/github-update'
import {
  compareSemver,
  parseSetupInstallerName,
  pickNewestInstaller,
  type LocalUpdateCheck
} from '@shared/local-update'
import { localReleaseNotesSearchDirs } from './release-notes-dirs'
import { loadSettings } from '../settings/store'
import { logger } from '../logging'

const GITHUB_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'LoraTraining',
  'X-GitHub-Api-Version': '2022-11-28'
}

interface GithubReleaseJson {
  tag_name?: string
  name?: string
  body?: string | null
  html_url?: string
  assets?: GithubInstallerAsset[]
}

function folderResult(
  currentVersion: string,
  extra: Partial<LocalUpdateCheck> & Pick<LocalUpdateCheck, 'message'>
): LocalUpdateCheck {
  return {
    currentVersion,
    latestVersion: null,
    installerPath: null,
    installerFileName: null,
    downloadUrl: null,
    source: 'folder',
    updateAvailable: false,
    ...extra
  }
}

function githubResult(
  currentVersion: string,
  extra: Partial<LocalUpdateCheck> & Pick<LocalUpdateCheck, 'message'>
): LocalUpdateCheck {
  return {
    currentVersion,
    latestVersion: null,
    installerPath: null,
    installerFileName: null,
    downloadUrl: null,
    source: 'github',
    updateAvailable: false,
    ...extra
  }
}

function resolveUpdateFolder(folder: string): string {
  const abs = resolve(folder.trim())
  if (!existsSync(abs)) {
    throw appError('validation', `Update check folder not found: ${abs}`, {
      remediation: 'Browse to the folder that contains LoraTraining Setup *.exe installers, or clear it to use GitHub Releases.'
    })
  }
  return abs
}

async function checkFolderUpdate(currentVersion: string, folder: string): Promise<LocalUpdateCheck> {
  const abs = resolveUpdateFolder(folder)
  const names = await readdir(abs)
  const newest = pickNewestInstaller(names)
  if (!newest) {
    return folderResult(currentVersion, {
      message: 'No LoraTraining Setup *.exe found in that folder.'
    })
  }
  const installerPath = join(abs, newest.fileName)
  const updateAvailable = compareSemver(newest.version, currentVersion) > 0
  const message = updateAvailable
    ? `Update available: v${currentVersion} → v${newest.version}`
    : compareSemver(newest.version, currentVersion) === 0
      ? `You are on the latest version (v${currentVersion}).`
      : `Folder has v${newest.version}, which is older than the running app (v${currentVersion}).`
  return folderResult(currentVersion, {
    latestVersion: newest.version,
    installerPath,
    installerFileName: newest.fileName,
    updateAvailable,
    message
  })
}

async function fetchGithubJson(url: string): Promise<GithubReleaseJson> {
  let res: Response
  try {
    res = await fetch(url, { headers: GITHUB_HEADERS })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw appError('unknown', `Could not reach GitHub: ${message}`, {
      remediation: 'Check the network connection, or set Release folder to a local installer directory.'
    })
  }
  if (res.status === 404) {
    throw appError('not-found', 'No GitHub release was found.', {
      remediation: 'Publish a vX.Y.Z release, or set Release folder to a local installer directory.'
    })
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const detail = text.replace(/\s+/g, ' ').trim().slice(0, 180)
    throw appError(
      'unknown',
      detail ? `GitHub returned ${res.status}: ${detail}` : `GitHub returned ${res.status}.`
    )
  }
  return (await res.json()) as GithubReleaseJson
}

async function checkGithubUpdate(currentVersion: string): Promise<LocalUpdateCheck> {
  const release = await fetchGithubJson(GITHUB_LATEST_RELEASE_API)
  const assets = (release.assets ?? []).flatMap((asset) => {
    const name = asset.name?.trim()
    const browser_download_url = asset.browser_download_url?.trim()
    return name && browser_download_url ? [{ name, browser_download_url }] : []
  })
  const picked = pickGithubInstaller(assets)
  if (!picked) {
    return githubResult(currentVersion, {
      message: 'The latest GitHub release has no LoraTraining Setup installer.'
    })
  }
  const updateAvailable = compareSemver(picked.version, currentVersion) > 0
  const message = updateAvailable
    ? `Update available: v${currentVersion} → v${picked.version}`
    : compareSemver(picked.version, currentVersion) === 0
      ? `You are on the latest version (v${currentVersion}).`
      : `GitHub has v${picked.version}, which is older than the running app (v${currentVersion}).`
  return githubResult(currentVersion, {
    latestVersion: picked.version,
    downloadUrl: picked.downloadUrl,
    installerFileName: picked.fileName,
    updateAvailable,
    message
  })
}

/**
 * A saved release folder scans local Setup exes. An empty folder checks the
 * public GitHub release for this repo.
 */
export async function checkLocalUpdate(): Promise<LocalUpdateCheck> {
  const settings = await loadSettings()
  const currentVersion = app.getVersion()
  const folder = settings.updateCheckFolder.trim()
  if (!folder) return checkGithubUpdate(currentVersion)
  return checkFolderUpdate(currentVersion, folder)
}

async function launchInstaller(installerPath: string): Promise<void> {
  const openErr = await shell.openPath(installerPath)
  if (openErr) {
    logger.warn({ installerPath, openErr }, 'shell.openPath failed; falling back to cmd start')
    if (process.platform === 'win32') {
      const child = spawn('cmd.exe', ['/c', 'start', '""', installerPath], {
        detached: true,
        stdio: 'ignore',
        cwd: dirname(installerPath),
        windowsHide: false
      })
      child.unref()
    } else {
      const child = spawn(installerPath, [], {
        detached: true,
        stdio: 'ignore',
        cwd: dirname(installerPath)
      })
      child.unref()
    }
  } else {
    logger.info({ installerPath }, 'update installer launched via shell.openPath')
  }
  setTimeout(() => {
    app.quit()
  }, 400)
}

async function downloadGithubInstaller(downloadUrl: string, fileName: string): Promise<string> {
  if (!isOfficialDownloadUrl(downloadUrl)) {
    throw appError('validation', 'Refusing to download an installer from an unexpected address.')
  }
  const safeName = fileName.replace(/^.*[/\\]/, '')
  if (safeName !== fileName || !parseSetupInstallerName(safeName)) {
    throw appError('validation', 'The release asset is not a LoraTraining Setup installer.')
  }

  const dir = join(app.getPath('temp'), 'LoraTraining-update')
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, safeName)
  const partial = `${dest}.partial`
  rmSync(partial, { force: true })

  let res: Response
  try {
    res = await fetch(downloadUrl, {
      headers: { 'User-Agent': 'LoraTraining', Accept: 'application/octet-stream' },
      redirect: 'follow'
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw appError('unknown', `Could not download the installer: ${message}`)
  }
  if (!res.ok) {
    throw appError('unknown', `Download failed (HTTP ${res.status}).`)
  }

  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength <= 0) throw appError('unknown', 'The downloaded installer was empty.')
    writeFileSync(dest, buf)
    return dest
  }

  const file = createWriteStream(partial)
  let doneBytes = 0
  try {
    const reader = res.body.getReader()
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (!value?.byteLength) continue
      if (!file.write(value)) await once(file, 'drain')
      doneBytes += value.byteLength
    }
    const finished = once(file, 'finish')
    file.end()
    await finished
  } catch (err) {
    file.destroy()
    rmSync(partial, { force: true })
    const message = err instanceof Error ? err.message : String(err)
    throw appError('unknown', `Could not download the installer: ${message}`)
  }

  if (doneBytes <= 0) {
    rmSync(partial, { force: true })
    throw appError('unknown', 'The downloaded installer was empty.')
  }

  rmSync(dest, { force: true })
  renameSync(partial, dest)
  return dest
}

async function installGithubUpdate(): Promise<{ launched: true }> {
  const check = await checkGithubUpdate(app.getVersion())
  if (!check.updateAvailable || !check.downloadUrl || !check.installerFileName) {
    throw appError('validation', check.message || 'No GitHub update is available.', {
      remediation: 'Run Check for update again.'
    })
  }
  const installerPath = await downloadGithubInstaller(check.downloadUrl, check.installerFileName)
  await launchInstaller(installerPath)
  return { launched: true }
}

/**
 * Folder installs launch a Setup exe inside the configured release folder.
 * An empty folder downloads the newest GitHub Setup exe, then launches it.
 * Either way the app quits so NSIS can replace files.
 */
export async function installLocalUpdate(installerPathRaw?: string): Promise<{ launched: true }> {
  const settings = await loadSettings()
  const folder = settings.updateCheckFolder.trim()
  if (!folder) return installGithubUpdate()

  const abs = resolveUpdateFolder(folder)
  const check = await checkFolderUpdate(app.getVersion(), folder)
  const installerPath = resolve(installerPathRaw?.trim() || check.installerPath || '')
  if (!installerPath || !existsSync(installerPath)) {
    throw appError('validation', 'Installer not found', {
      remediation: 'Run Check for update first, or rebuild with npm run dist:nobump.'
    })
  }
  const parsed = parseSetupInstallerName(installerPath)
  if (!parsed) {
    throw appError('validation', 'Not a LoraTraining Setup installer', {
      remediation: 'Expected a file named like “LoraTraining Setup 0.4.0.exe”.'
    })
  }
  if (dirname(installerPath).toLowerCase() !== resolve(abs).toLowerCase()) {
    throw appError('validation', 'Installer is outside the configured release folder', {
      remediation: 'Only installers inside the Release folder can be launched.'
    })
  }
  if (!statSync(installerPath).isFile()) {
    throw appError('validation', 'Installer not found')
  }
  await launchInstaller(installerPath)
  return { launched: true }
}

function readNotesInDirs(dirs: string[]): string | null {
  for (const dir of dirs) {
    const file = join(dir, 'RELEASE_NOTES.md')
    try {
      if (!existsSync(file) || !statSync(file).isFile()) continue
      const text = readFileSync(file, 'utf8')
      if (text.trim()) return text
    } catch {
      continue
    }
  }
  return null
}

async function fetchReleaseByTag(tag: string): Promise<GithubReleaseJson | null> {
  let res: Response
  try {
    res = await fetch(githubReleaseApiUrl(tag), { headers: GITHUB_HEADERS })
  } catch {
    return null
  }
  if (!res.ok) return null
  return (await res.json()) as GithubReleaseJson
}

async function fetchRawReleaseNotes(tag: string): Promise<string | null> {
  let res: Response
  try {
    res = await fetch(githubReleaseNotesRawUrl(tag), {
      headers: { 'User-Agent': 'LoraTraining' }
    })
  } catch {
    return null
  }
  if (!res.ok) return null
  const text = await res.text()
  const trimmed = text.trim()
  if (!trimmed || /^404[:\s]/i.test(trimmed)) return null
  return text
}

/**
 * Notes for a detected version. A release folder reads `RELEASE_NOTES.md`
 * there or in the parent folder and does not contact GitHub. An empty folder
 * uses the GitHub release for that version.
 */
export async function fetchAppReleaseNotes(version: string): Promise<AppReleaseNotes> {
  const trimmed = version.trim()
  const title = `What's new in ${trimmed}`
  const settings = await loadSettings()
  const folder = settings.updateCheckFolder.trim()
  if (folder) {
    const local = readNotesInDirs(localReleaseNotesSearchDirs(folder))
    return {
      version: trimmed,
      title,
      markdown:
        local ??
        `No \`RELEASE_NOTES.md\` was found in the release folder or the folder above it.\n\n\`${resolve(folder)}\``,
      htmlUrl: null,
      tag: null
    }
  }

  const tags = githubReleaseTagCandidates(trimmed)
  for (const tag of tags) {
    const json = await fetchReleaseByTag(tag)
    const body = json?.body?.trim() ?? ''
    const markdown = body || (await fetchRawReleaseNotes(tag)) || ''
    if (!markdown.trim()) continue
    return {
      version: trimmed,
      title: json?.name?.trim() || title,
      markdown,
      htmlUrl:
        json?.html_url?.trim() ||
        `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tag/${encodeURIComponent(tag)}`,
      tag
    }
  }

  return {
    version: trimmed,
    title,
    markdown: `Release notes for ${trimmed} are not on GitHub yet.\n\nThey show up here after that version is published.`,
    htmlUrl: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`,
    tag: tags[0] ?? null
  }
}
