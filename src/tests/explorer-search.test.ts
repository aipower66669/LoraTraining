import { describe, expect, it } from 'vitest'
import { matchesExplorerName, parseExplorerNameQuery } from '@shared/explorer-search'

describe('parseExplorerNameQuery', () => {
  it('treats plain text as substring search', () => {
    expect(parseExplorerNameQuery('  Baby  ')).toEqual({
      needle: 'baby',
      wholeWord: false
    })
  })

  it('treats double-quoted text as whole-word search', () => {
    expect(parseExplorerNameQuery('"Girl"')).toEqual({
      needle: 'girl',
      wholeWord: true
    })
    expect(parseExplorerNameQuery('  "Baby Girl"  ')).toEqual({
      needle: 'baby girl',
      wholeWord: true
    })
  })

  it('ignores empty quotes', () => {
    expect(parseExplorerNameQuery('""')).toEqual({ needle: '', wholeWord: true })
  })
})

describe('matchesExplorerName', () => {
  it('matches substrings when not whole-word', () => {
    expect(matchesExplorerName('BabyGirl', 'baby', false)).toBe(true)
    expect(matchesExplorerName('BabyGirl', 'gir', false)).toBe(true)
  })

  it('matches whole words when quoted', () => {
    expect(matchesExplorerName('Baby Girl', 'girl', true)).toBe(true)
    expect(matchesExplorerName('Baby Girlfriend', 'girl', true)).toBe(false)
    expect(matchesExplorerName('Girl', 'girl', true)).toBe(true)
    expect(matchesExplorerName('BabyGirl', 'girl', true)).toBe(false)
  })

  it('matches multi-word quoted phrases as a unit', () => {
    expect(matchesExplorerName('The Baby Girl set', 'baby girl', true)).toBe(true)
    expect(matchesExplorerName('Baby Girlfriend', 'baby girl', true)).toBe(false)
  })
})
