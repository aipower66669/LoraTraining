import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { BUNDLED_JOYCAPTION_SCRIPT } from '@shared/joycaption'
import {
  resolveBundledJoyCaptionDir,
  resolveJoyCaptionScriptPath
} from '@main/runners/joycaption-script-path'

describe('joycaption-script-path', () => {
  it('resolves the bundled captioner directory', () => {
    const dir = resolveBundledJoyCaptionDir()
    expect(dir).toBeTruthy()
    expect(dir!.replace(/\\/g, '/')).toMatch(/resources\/joycaption$/)
  })

  it('uses work-dir copy when present', () => {
    const wd = join(tmpdir(), `lt-joy-${Date.now()}`)
    mkdirSync(wd, { recursive: true })
    const local = join(wd, BUNDLED_JOYCAPTION_SCRIPT)
    writeFileSync(local, '# local override\n', 'utf8')
    expect(resolveJoyCaptionScriptPath(BUNDLED_JOYCAPTION_SCRIPT, wd)).toBe(local)
  })

  it('falls back to bundled script when work dir has no copy', () => {
    const wd = join(tmpdir(), `lt-joy-empty-${Date.now()}`)
    mkdirSync(wd, { recursive: true })
    const resolved = resolveJoyCaptionScriptPath('', wd)
    expect(resolved.replace(/\\/g, '/')).toMatch(
      new RegExp(`resources/joycaption/${BUNDLED_JOYCAPTION_SCRIPT}$`)
    )
  })
})
