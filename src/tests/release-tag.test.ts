import { describe, expect, it } from 'vitest'
import { versionFromReleaseTag } from '@shared/release-tag'

describe('release-tag', () => {
  it('maps vX.Y.Z to X.Y.Z', () => {
    expect(versionFromReleaseTag('v0.3.0')).toBe('0.3.0')
    expect(versionFromReleaseTag('v1.12.34')).toBe('1.12.34')
  })

  it('rejects vX.Y and other invalid tags', () => {
    expect(() => versionFromReleaseTag('v0.3')).toThrow(/Invalid release tag/)
    expect(() => versionFromReleaseTag('v2.1')).toThrow(/Invalid release tag/)
    expect(() => versionFromReleaseTag('0.3.0')).toThrow(/Invalid release tag/)
    expect(() => versionFromReleaseTag('v1')).toThrow(/Invalid release tag/)
    expect(() => versionFromReleaseTag('v1.2.3.4')).toThrow(/Invalid release tag/)
    expect(() => versionFromReleaseTag('vbeta')).toThrow(/Invalid release tag/)
  })
})
