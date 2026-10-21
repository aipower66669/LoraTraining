import { describe, expect, it } from 'vitest'
import { appError } from '@shared/errors'
import { assertInsideRoot } from '@main/security/path-guards'

describe('path guards', () => {
  it('allows paths inside root', () => {
    const root = 'C:\\datasets\\concept'
    const full = assertInsideRoot(root, 'C:\\datasets\\concept\\a.txt')
    expect(full.toLowerCase()).toContain('a.txt')
  })

  it('rejects path escape', () => {
    try {
      assertInsideRoot('C:\\datasets\\concept', 'C:\\datasets\\other\\a.txt')
      expect.fail('should throw')
    } catch (err) {
      expect(err).toMatchObject({ code: 'path-escape' })
    }
  })

  it('builds app errors', () => {
    expect(appError('validation', 'bad').code).toBe('validation')
  })
})
