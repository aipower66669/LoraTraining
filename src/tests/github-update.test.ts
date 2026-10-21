import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { localReleaseNotesSearchDirs } from '../main/update/release-notes-dirs'
import {
  githubReleaseTagCandidates,
  isOfficialDownloadUrl,
  pickGithubInstaller,
  resolveReleaseNotesHref
} from '../shared/github-update'

describe('github release helpers', () => {
  it('tries the v-prefixed tag before the bare version', () => {
    expect(githubReleaseTagCandidates('0.4.0')).toEqual(['v0.4.0', '0.4.0'])
    expect(githubReleaseTagCandidates('v1.2.3')).toEqual(['v1.2.3', '1.2.3'])
  })

  it('accepts only this repo’s release download URLs', () => {
    expect(
      isOfficialDownloadUrl(
        'https://github.com/aipower66669/LoraTraining/releases/download/v0.4.0/LoraTraining%20Setup%200.4.0.exe'
      )
    ).toBe(true)
    expect(
      isOfficialDownloadUrl('https://github.com/aipower66669/LoraTraining/releases/download/v0.4.0/notes.md')
    ).toBe(true)
    expect(isOfficialDownloadUrl('https://example.com/LoraTraining%20Setup%200.4.0.exe')).toBe(false)
    expect(
      isOfficialDownloadUrl(
        'https://github.com/other/LoraTraining/releases/download/v0.4.0/LoraTraining%20Setup%200.4.0.exe'
      )
    ).toBe(false)
    expect(isOfficialDownloadUrl('http://github.com/aipower66669/LoraTraining/releases/download/v0.4.0/a.exe')).toBe(
      false
    )
  })

  it('picks the newest official Setup exe and ignores other assets', () => {
    const picked = pickGithubInstaller([
      {
        name: 'SHA256SUMS.txt',
        browser_download_url:
          'https://github.com/aipower66669/LoraTraining/releases/download/v0.4.0/SHA256SUMS.txt'
      },
      {
        name: 'LoraTraining Setup 0.4.0.exe',
        browser_download_url:
          'https://github.com/aipower66669/LoraTraining/releases/download/v0.4.0/LoraTraining%20Setup%200.4.0.exe'
      },
      {
        name: 'LoraTraining Setup 0.3.0.exe',
        browser_download_url: 'https://evil.example/LoraTraining%20Setup%200.9.0.exe'
      }
    ])
    expect(picked).toEqual({
      fileName: 'LoraTraining Setup 0.4.0.exe',
      version: '0.4.0',
      downloadUrl:
        'https://github.com/aipower66669/LoraTraining/releases/download/v0.4.0/LoraTraining%20Setup%200.4.0.exe'
    })
  })

  it('searches the update folder and its parent for release notes', () => {
    const folder = resolve('release')
    expect(localReleaseNotesSearchDirs(folder)).toEqual([folder, dirname(folder)])
  })

  it('resolves relative release-note links onto the tag and keeps https links', () => {
    expect(resolveReleaseNotesHref('https://example.com/docs', 'v0.4.0')).toBe('https://example.com/docs')
    expect(resolveReleaseNotesHref('docs/USER_GUIDE.md', 'v0.4.0')).toBe(
      'https://github.com/aipower66669/LoraTraining/blob/v0.4.0/docs/USER_GUIDE.md'
    )
    expect(resolveReleaseNotesHref('docs/USER_GUIDE.md#settings', 'v0.4.0')).toBe(
      'https://github.com/aipower66669/LoraTraining/blob/v0.4.0/docs/USER_GUIDE.md#settings'
    )
    expect(resolveReleaseNotesHref('../secrets.md', 'v0.4.0')).toBeNull()
    expect(resolveReleaseNotesHref('javascript:alert(1)', 'v0.4.0')).toBeNull()
    expect(resolveReleaseNotesHref('docs/USER_GUIDE.md', null)).toBeNull()
  })
})
