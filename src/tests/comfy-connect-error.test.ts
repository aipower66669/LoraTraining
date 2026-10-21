import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COMFY_CONNECTION,
  formatComfyConnectError,
  isComfyUnreachableError,
  shortenComfyError
} from '@shared/comfy'

describe('formatComfyConnectError', () => {
  it('rewrites fetch failed with server URL', () => {
    const msg = formatComfyConnectError(DEFAULT_COMFY_CONNECTION, new Error('fetch failed'))
    expect(msg).toContain('Could not connect to ComfyUI')
    expect(msg).toContain('http://127.0.0.1:8188')
    expect(msg).not.toBe('fetch failed')
  })

  it('detects common unreachable errors', () => {
    expect(isComfyUnreachableError(new Error('fetch failed'))).toBe(true)
    expect(isComfyUnreachableError(new Error('ECONNREFUSED'))).toBe(true)
    expect(isComfyUnreachableError(new Error('HTTP 500'))).toBe(false)
  })

  it('includes URL for other errors', () => {
    const msg = formatComfyConnectError(
      { host: '192.168.1.10', port: 9000, secure: false },
      new Error('weird')
    )
    expect(msg).toContain('http://192.168.1.10:9000')
    expect(msg).toContain('weird')
  })
})

describe('shortenComfyError', () => {
  it('prefers ValueError lines from a traceback wall', () => {
    const wall = `Traceback (most recent call last):
  File "x.py", line 1
ValueError: Expected trailing dimension of mat1 to be divisible by 16 but got mat1 shape: (243200x12).
`
    expect(shortenComfyError(wall)).toBe(
      'ValueError: Expected trailing dimension of mat1 to be divisible by 16 but got mat1 shape: (243200x12).'
    )
  })

  it('uses Comfy exception-during-processing summary', () => {
    expect(
      shortenComfyError('[ERROR] !!! Exception during processing !!! Expected trailing dimension of mat1')
    ).toContain('Expected trailing dimension')
  })
})
