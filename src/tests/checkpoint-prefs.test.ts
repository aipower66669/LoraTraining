import { describe, expect, it } from 'vitest'
import { emptyCheckpointPrefs, isKeepInComfy } from '@shared/checkpoint-prefs'

describe('checkpoint prefs', () => {
  it('defaults missing stems to keep', () => {
    const prefs = emptyCheckpointPrefs()
    expect(isKeepInComfy(prefs, 'job_000000250')).toBe(true)
  })

  it('honors explicit false', () => {
    const prefs = emptyCheckpointPrefs()
    prefs.keepInComfy['job_000000250'] = false
    expect(isKeepInComfy(prefs, 'job_000000250')).toBe(false)
    expect(isKeepInComfy(prefs, 'job_000000500')).toBe(true)
  })
})
