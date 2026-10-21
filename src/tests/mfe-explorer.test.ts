import { describe, expect, it } from 'vitest'
import { mfeOpenUrl, mfeRevealUrl } from '../main/util/mfe-explorer'

describe('mfe explorer URLs', () => {
  it('URI-encodes Windows paths for reveal', () => {
    expect(mfeRevealUrl('D:\\Projects\\shot.png')).toBe(
      'mfe://reveal?path=D%3A%5CProjects%5Cshot.png'
    )
  })

  it('URI-encodes Windows paths for open', () => {
    expect(mfeOpenUrl('D:\\Projects')).toBe('mfe://open?path=D%3A%5CProjects')
  })
})
