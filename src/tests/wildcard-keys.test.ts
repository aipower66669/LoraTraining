import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  listWildcardKeysFromFolder,
  wildcardKeyFromRelativePath
} from '../main/wildcards/listKeys'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('wildcardKeyFromRelativePath', () => {
  it('strips known extensions and normalizes slashes', () => {
    expect(wildcardKeyFromRelativePath('colors/primary.txt')).toBe('colors/primary')
    expect(wildcardKeyFromRelativePath('a\\b.yaml')).toBe('a/b')
    expect(wildcardKeyFromRelativePath('root.json')).toBe('root')
  })
})

describe('listWildcardKeysFromFolder', () => {
  it('walks nested txt/yaml/json and returns sorted unique keys', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lora-wildcards-'))
    tempDirs.push(root)
    await mkdir(join(root, 'colors'), { recursive: true })
    await writeFile(join(root, 'colors', 'primary.txt'), 'red\nblue\n', 'utf8')
    await writeFile(join(root, 'poses.txt'), 'standing\n', 'utf8')
    await writeFile(join(root, 'meta.yaml'), 'a: 1\n', 'utf8')
    await writeFile(join(root, 'readme.md'), 'ignore', 'utf8')
    await mkdir(join(root, '.hidden'), { recursive: true })
    await writeFile(join(root, '.hidden', 'secret.txt'), 'nope', 'utf8')

    const keys = await listWildcardKeysFromFolder(root)
    expect(keys).toEqual(['colors/primary', 'meta', 'poses'])
  })

  it('returns [] for empty path', async () => {
    expect(await listWildcardKeysFromFolder('')).toEqual([])
    expect(await listWildcardKeysFromFolder('   ')).toEqual([])
  })
})
