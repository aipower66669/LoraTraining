import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  extractLoraNamesFromText,
  loraRootNameFromTag,
  textReferencesLoraStem
} from '../shared/wildcard-lora-refs'
import { folderReferencesLoraStem } from '../main/wildcards/scanLoraRefs'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('loraRootNameFromTag', () => {
  it('strips numeric and brace step suffixes after the last underscore', () => {
    expect(loraRootNameFromTag('loraname_000000250')).toBe('loraname')
    expect(loraRootNameFromTag('loraname_000000500')).toBe('loraname')
    expect(loraRootNameFromTag('loraname_000000{250|500}')).toBe('loraname')
    expect(loraRootNameFromTag('loraname_00000{0250|0500}')).toBe('loraname')
    expect(loraRootNameFromTag('Cat_Ds_000000250')).toBe('Cat_Ds')
  })

  it('keeps unnumbered stems intact', () => {
    expect(loraRootNameFromTag('Cat_Ds')).toBe('Cat_Ds')
    expect(loraRootNameFromTag('loraname')).toBe('loraname')
  })
})

describe('extractLoraNamesFromText / textReferencesLoraStem', () => {
  it('finds tags with optional weights and brace variants', () => {
    const text = `
      __style__
      <lora:loraname_000000250>
      <lora:other_000000100:0.8>
      <lora:loraname_000000{250|500}:1>
    `
    expect(extractLoraNamesFromText(text)).toEqual([
      'loraname_000000250',
      'other_000000100',
      'loraname_000000{250|500}'
    ])
    expect(textReferencesLoraStem(text, 'loraname')).toBe(true)
    expect(textReferencesLoraStem(text, 'other')).toBe(true)
    expect(textReferencesLoraStem(text, 'missing')).toBe(false)
    expect(textReferencesLoraStem(text, 'lora')).toBe(false)
  })
})

describe('folderReferencesLoraStem', () => {
  it('scans nested wildcard files for LoRA root matches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lora-wc-refs-'))
    tempDirs.push(root)
    await mkdir(join(root, 'loras'), { recursive: true })
    await writeFile(
      join(root, 'loras', 'pool.txt'),
      '<lora:FluoKawaii_00000{0250|0500}>\n',
      'utf8'
    )
    await writeFile(join(root, 'other.txt'), 'no tags here\n', 'utf8')

    expect(await folderReferencesLoraStem(root, 'FluoKawaii')).toBe(true)
    expect(await folderReferencesLoraStem(root, 'Missing')).toBe(false)
  })
})
