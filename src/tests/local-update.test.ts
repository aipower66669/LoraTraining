import { describe, expect, it } from 'vitest'
import {
  compareSemver,
  parseSetupInstallerName,
  parseSemver,
  pickNewestInstaller
} from '../shared/local-update'

describe('parseSemver / compareSemver', () => {
  it('parses plain and v-prefixed versions', () => {
    expect(parseSemver('0.1.0')).toEqual([0, 1, 0])
    expect(parseSemver('v1.2.3')).toEqual([1, 2, 3])
    expect(parseSemver('nope')).toBeNull()
  })

  it('orders major/minor/patch', () => {
    expect(compareSemver('0.2.0', '0.1.9')).toBeGreaterThan(0)
    expect(compareSemver('0.1.0', '0.1.0')).toBe(0)
    expect(compareSemver('0.1.0', '0.1.1')).toBeLessThan(0)
  })
})

describe('setup installer discovery', () => {
  it('parses electron-builder default artifact names', () => {
    expect(parseSetupInstallerName('LoraTraining Setup 0.1.0.exe')).toEqual({
      fileName: 'LoraTraining Setup 0.1.0.exe',
      version: '0.1.0'
    })
    expect(parseSetupInstallerName('LoraTraining Setup 1.0.0-beta.1.exe')?.version).toBe(
      '1.0.0-beta.1'
    )
    expect(parseSetupInstallerName('readme.txt')).toBeNull()
    expect(parseSetupInstallerName('win-unpacked')).toBeNull()
  })

  it('picks the newest Setup exe from a folder listing', () => {
    const best = pickNewestInstaller([
      'builder-effective-config.yaml',
      'LoraTraining Setup 0.1.0.exe',
      'LoraTraining Setup 0.1.0.exe.blockmap',
      'LoraTraining Setup 0.2.0.exe',
      'LoraTraining Setup 0.1.5.exe'
    ])
    expect(best).toEqual({
      fileName: 'LoraTraining Setup 0.2.0.exe',
      version: '0.2.0'
    })
  })
})
