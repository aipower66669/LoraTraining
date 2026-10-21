/** Re-export shim still works for older import paths. */
import { describe, expect, it } from 'vitest'
import { upgradePinterestImageUrl } from '@shared/pinterest-image'

describe('pinterest-image re-export', () => {
  it('still upgrades pinimg thumbs', () => {
    expect(
      upgradePinterestImageUrl('https://i.pinimg.com/236x/ab/cd/ef/hash.jpg')
    ).toBe('https://i.pinimg.com/originals/ab/cd/ef/hash.jpg')
  })
})
