import { describe, expect, it } from 'vitest'
import {
  extractIdentityName,
  formatIdentityTag,
  hasIdentityTag,
  parseNamePool,
  parseUsedNamesFile,
  pickRandomUnusedName,
  serializeUsedNames,
  stripIdentityTag,
  upsertIdentityTag
} from '@shared/identity-tag'

describe('identity-tag helpers', () => {
  it('formats a distinctive marker', () => {
    expect(formatIdentityTag('Ada')).toBe('.photo of a girl named Ada.')
  })

  it('round-trips extract after upsert', () => {
    const next = upsertIdentityTag('beautiful woman, standing', 'Ada')
    expect(next).toBe('beautiful woman, standing .photo of a girl named Ada.')
    expect(extractIdentityName(next)).toBe('Ada')
    expect(hasIdentityTag(next)).toBe(true)
  })

  it('strip leaves other caption text intact', () => {
    const caption =
      'trigger, beautiful woman .photo of a girl named Ada. outdoors, smile'
    expect(stripIdentityTag(caption)).toBe('trigger, beautiful woman outdoors, smile')
  })

  it('upsert replaces an existing identity without duplicating', () => {
    const once = upsertIdentityTag('a woman', 'Ada')
    const twice = upsertIdentityTag(once, 'Bella')
    expect(twice).toBe('a woman .photo of a girl named Bella.')
    expect(extractIdentityName(twice)).toBe('Bella')
    expect(twice.match(/\.photo of a girl named/g)?.length).toBe(1)
  })

  it('upsert on empty caption is just the marker', () => {
    expect(upsertIdentityTag('', 'Zoe')).toBe('.photo of a girl named Zoe.')
  })

  it('pickRandomUnusedName never returns used names', () => {
    const pool = ['Ada', 'Bella', 'Cora']
    const used = new Set(['Ada', 'Bella'])
    const picks = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const n = pickRandomUnusedName(pool, used, () => 0.9)
      expect(n).toBe('Cora')
      picks.add(n!)
    }
    expect([...picks]).toEqual(['Cora'])
    expect(pickRandomUnusedName(pool, new Set(pool))).toBeNull()
  })

  it('serializeUsedNames sorts and round-trips', () => {
    const text = serializeUsedNames(['Zoe', 'Ada', 'Ada', 'Bella'])
    expect(text).toBe('Ada\nBella\nZoe\n')
    expect(parseUsedNamesFile(text)).toEqual(['Ada', 'Bella', 'Zoe'])
  })

  it('parseNamePool skips junk lines', () => {
    expect(parseNamePool('Ada\n\nBad Name\nBella\n123\n')).toEqual(['Ada', 'Bella'])
  })
})
