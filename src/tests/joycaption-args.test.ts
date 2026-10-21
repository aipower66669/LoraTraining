import { describe, expect, it } from 'vitest'
import { buildJoyCaptionArgs, mergeAppendedCaption } from '@shared/joycaption'

describe('buildJoyCaptionArgs', () => {
  it('skips --redo for missing mode and strips it from extraArgs', () => {
    expect(buildJoyCaptionArgs('F:\\ds', 'missing', ['--redo', '--prefix', 'x'])).toEqual([
      'F:\\ds',
      '--prefix',
      'x'
    ])
  })

  it('appends --redo for overwrite', () => {
    expect(buildJoyCaptionArgs('F:\\ds', 'overwrite', ['--prefix', 'x'])).toEqual([
      'F:\\ds',
      '--prefix',
      'x',
      '--redo'
    ])
  })

  it('appends --redo for append mode (runner merges prior captions after)', () => {
    expect(buildJoyCaptionArgs('F:\\ds', 'append')).toEqual(['F:\\ds', '--redo'])
  })

  it('merges prior + generated with ". " sentence join', () => {
    expect(mergeAppendedCaption('old caption', 'new caption')).toBe('old caption. new caption')
    expect(mergeAppendedCaption('old caption,', 'new caption')).toBe('old caption. new caption')
    expect(mergeAppendedCaption('old caption, ', 'new caption')).toBe('old caption. new caption')
    expect(mergeAppendedCaption('old caption.', 'new caption')).toBe('old caption. new caption')
    expect(mergeAppendedCaption('old caption. ', 'new caption')).toBe('old caption. new caption')
    expect(mergeAppendedCaption('', 'only new')).toBe('only new')
    expect(mergeAppendedCaption('only old', '')).toBe('only old')
    expect(mergeAppendedCaption('\uFEFFold  ', '  new  ')).toBe('old. new')
  })

  it('passes --context-file and --trigger-token via options object', () => {
    expect(
      buildJoyCaptionArgs('F:\\ds', {
        mode: 'missing',
        extraArgs: ['--prefix', 'x'],
        contextFile: 'F:\\logs\\caption-context.txt',
        triggerToken: 'mytrigger'
      })
    ).toEqual([
      'F:\\ds',
      '--prefix',
      'x',
      '--trigger-token',
      'mytrigger',
      '--context-file',
      'F:\\logs\\caption-context.txt'
    ])
  })

  it('strips conflicting context/trigger flags from extraArgs', () => {
    expect(
      buildJoyCaptionArgs('F:\\ds', {
        mode: 'overwrite',
        extraArgs: [
          '--context-file',
          'old.txt',
          '--trigger-token',
          'old',
          '--prefix',
          'x'
        ],
        contextFile: 'new.txt',
        triggerToken: 'tok'
      })
    ).toEqual([
      'F:\\ds',
      '--prefix',
      'x',
      '--trigger-token',
      'tok',
      '--context-file',
      'new.txt',
      '--redo'
    ])
  })

  it('omits empty trigger and context', () => {
    expect(
      buildJoyCaptionArgs('F:\\ds', {
        mode: 'missing',
        triggerToken: '  ',
        contextFile: null
      })
    ).toEqual(['F:\\ds'])
  })
})
