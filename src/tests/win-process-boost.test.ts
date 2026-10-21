import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('win-process-boost script', () => {
  it('does not use $pid as a loop variable (shadows PowerShell $PID)', () => {
    const src = readFileSync(
      resolve(__dirname, '../main/runners/win-process-boost.ts'),
      'utf8'
    )
    expect(src).toContain('foreach ($procId in')
    expect(src).not.toMatch(/foreach\s*\(\s*\$pid\s+in/i)
  })
})
