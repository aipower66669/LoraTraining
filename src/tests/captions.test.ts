import { describe, expect, it } from 'vitest'
import {
  applyBulkOp,
  hasTrigger,
  normalizePrefixSeparator,
  normalizeSuffixSeparator
} from '@shared/captions/transforms'

describe('caption transforms', () => {
  it('detects trigger as a caption token (case-insensitive, comma-aware)', () => {
    expect(hasTrigger('ohwx person standing', 'ohwx person')).toBe(true)
    expect(hasTrigger('foohwx person', 'ohwx person')).toBe(false)
    expect(hasTrigger('ohwx person', 'ohwx person')).toBe(true)
    expect(hasTrigger('tok, portrait', 'tok')).toBe(true)
    expect(hasTrigger('TOK, portrait', 'tok')).toBe(true)
    expect(hasTrigger('a woman, tok, outdoors', 'TOK')).toBe(true)
    expect(hasTrigger('1girl,tok,solo', 'tok')).toBe(true)
    expect(hasTrigger('\uFEFFtok, portrait', 'tok')).toBe(true)
    expect(hasTrigger('portrait of a woman', 'tok')).toBe(false)
  })

  it('applies prefix/suffix/replace/remove', () => {
    expect(applyBulkOp('cat', { op: 'prefix', value: 'ohwx' }, '').text).toBe('ohwx, cat')
    expect(applyBulkOp('cat', { op: 'prefix', value: 'ohwx, ' }, '').text).toBe('ohwx, cat')
    expect(applyBulkOp('cat', { op: 'suffix', value: 'sitting' }, '').text).toBe('cat, sitting')
    expect(applyBulkOp('cat', { op: 'suffix', value: ', sitting' }, '').text).toBe('cat, sitting')
    expect(applyBulkOp('a cat sat', { op: 'replace', find: 'cat', replace: 'dog' }, '').text).toBe(
      'a dog sat'
    )
    expect(applyBulkOp('a cat sat', { op: 'remove', value: 'cat ' }, '').text).toBe('a sat')
  })

  it('does not double the ", " separator when already present', () => {
    expect(normalizePrefixSeparator('tok, ')).toBe('tok, ')
    expect(normalizeSuffixSeparator(', tok')).toBe(', tok')
    expect(normalizePrefixSeparator('tok')).toBe('tok, ')
    expect(normalizeSuffixSeparator('tok')).toBe(', tok')
  })

  it('ensures and strips trigger', () => {
    const ensured = applyBulkOp('portrait', { op: 'ensureTrigger', mode: 'prepend' }, 'tok')
    expect(ensured.text).toBe('tok, portrait')
    expect(ensured.changed).toBe(true)
    const skip = applyBulkOp('tok, portrait', { op: 'ensureTrigger', mode: 'prepend' }, 'tok')
    expect(skip.changed).toBe(false)
    const skipCase = applyBulkOp('TOK, portrait', { op: 'ensureTrigger', mode: 'prepend' }, 'tok')
    expect(skipCase.changed).toBe(false)
    const stripped = applyBulkOp('tok, portrait', { op: 'stripTrigger' }, 'tok')
    expect(stripped.text).toBe('portrait')
  })

  it('uses op.trigger override over the dataset trigger argument', () => {
    const skip = applyBulkOp(
      'uiTok, a woman',
      { op: 'ensureTrigger', mode: 'prepend', trigger: 'uiTok' },
      'diskTok'
    )
    expect(skip.changed).toBe(false)
    const change = applyBulkOp(
      'uiTok, a woman',
      { op: 'ensureTrigger', mode: 'prepend', trigger: 'diskTok' },
      'diskTok'
    )
    expect(change.changed).toBe(true)
    expect(change.text).toBe('diskTok, uiTok, a woman')
  })

  it('setText: missing / overwrite / append with optional prepend trigger', () => {
    const skipExisting = applyBulkOp(
      'already',
      { op: 'setText', value: 'new', mode: 'missing' },
      'tok'
    )
    expect(skipExisting.changed).toBe(false)

    const createMissing = applyBulkOp(
      null,
      { op: 'setText', value: 'hello', mode: 'missing', prependTrigger: true, trigger: 'tok' },
      'tok'
    )
    expect(createMissing.text).toBe('tok, hello')
    expect(createMissing.create).toBe(true)

    const overwrite = applyBulkOp(
      'old',
      { op: 'setText', value: 'new', mode: 'overwrite', prependTrigger: true, trigger: 'tok' },
      'tok'
    )
    expect(overwrite.text).toBe('tok, new')

    const append = applyBulkOp(
      'prior caption',
      { op: 'setText', value: 'extra detail', mode: 'append' },
      ''
    )
    expect(append.text).toBe('prior caption. extra detail')
  })
})
