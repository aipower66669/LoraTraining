import { describe, expect, it } from 'vitest'
import { buildStreamPath, parseBackupStreamName, validateStreamName } from '../shared/ads/paths'

describe('ADS path helpers', () => {
  it('builds path:stream:$DATA', () => {
    expect(buildStreamPath('C:\\photos\\a.jpg', 'VER_1')).toBe(
      'C:\\photos\\a.jpg:VER_1:$DATA'
    )
  })

  it('parses BackupRead stream names', () => {
    expect(parseBackupStreamName(':VER_1:$DATA\0')).toBe('VER_1')
    expect(parseBackupStreamName('::$DATA\0')).toBeNull()
  })

  it('rejects invalid stream name chars', () => {
    expect(() => validateStreamName('bad:name')).toThrow()
    expect(() => validateStreamName('VER_1')).not.toThrow()
  })
})
