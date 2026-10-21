import { constants, getPriority, platform, setPriority } from 'node:os'
import { delimiter } from 'node:path'
import { describe, expect, it } from 'vitest'
import { boostChildPriority, pythonChildEnv } from '../main/runners/process-utils'

describe('pythonChildEnv', () => {
  it('forces UTF-8 stdio for Windows charmap safety', () => {
    const env = pythonChildEnv({ FOO: 'bar' })
    expect(env.PYTHONIOENCODING).toBe('utf-8')
    expect(env.PYTHONUTF8).toBe('1')
    expect(env.FOO).toBe('bar')
  })

  it('does not let callers override UTF-8 flags', () => {
    const env = pythonChildEnv({ PYTHONIOENCODING: 'cp1252', PYTHONUTF8: '0' })
    expect(env.PYTHONIOENCODING).toBe('utf-8')
    expect(env.PYTHONUTF8).toBe('1')
  })

  it('prepends python-shims to PYTHONPATH on Windows', () => {
    if (platform() !== 'win32') return
    const env = pythonChildEnv({ PYTHONPATH: 'C:\\existing' })
    expect(env.PYTHONPATH).toBeTruthy()
    const parts = env.PYTHONPATH!.split(delimiter)
    expect(parts[0]?.replace(/\\/g, '/')).toMatch(/resources\/python-shims$/i)
    expect(parts).toContain('C:\\existing')
  })
})

describe('boostChildPriority', () => {
  it('raises this process to PRIORITY_HIGH', () => {
    const prev = getPriority(process.pid)
    try {
      boostChildPriority(process.pid)
      expect(getPriority(process.pid)).toBe(constants.priority.PRIORITY_HIGH)
    } finally {
      setPriority(process.pid, prev)
    }
  })
})
