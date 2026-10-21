import { describe, expect, it } from 'vitest'
import { composeValidationPrompt } from '@shared/validation-prompt'

describe('composeValidationPrompt', () => {
  it('appends lora tag and trigger', () => {
    expect(composeValidationPrompt('a woman', 'job_000000500', 1, 'ohwx')).toBe(
      'a woman, <lora:job_000000500:1> ohwx'
    )
  })

  it('handles empty prompt', () => {
    expect(composeValidationPrompt('', 'x', 0.8, 'tok')).toBe('<lora:x:0.8> tok')
  })

  it('handles trailing comma', () => {
    expect(composeValidationPrompt('a cat,', 'x', 1, 'tok')).toBe('a cat, <lora:x:1> tok')
  })

  it('uses bare stem only (no folder prefix)', () => {
    expect(composeValidationPrompt('a woman', 'job_000000500', 1, 'ohwx')).toBe(
      'a woman, <lora:job_000000500:1> ohwx'
    )
  })

  it('omits trailing space when trigger is empty', () => {
    expect(composeValidationPrompt('a dog', 'x', 1, '')).toBe('a dog, <lora:x:1>')
  })
})
