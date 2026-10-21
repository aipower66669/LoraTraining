import { describe, expect, it } from 'vitest'
import {
  formatCaptionProgressStatus,
  parseCaptionOkLine,
  parseCaptionToProcessLine,
  stripAnsi
} from '@shared/caption-progress'

describe('caption progress parsing', () => {
  it('strips ansi and parses OK lines', () => {
    const line = stripAnsi('\u001b[32m[OK] 0028.jpg -> 0028.txt\u001b[0m')
    expect(parseCaptionOkLine(line)).toBe('0028.jpg')
    expect(parseCaptionOkLine('[OK] sub\\foo.png -> foo.txt')).toBe('foo.png')
  })

  it('parses to-process count', () => {
    expect(parseCaptionToProcessLine('To process        : 58')).toBe(58)
  })

  it('formats Processing X of N (M%)', () => {
    expect(
      formatCaptionProgressStatus({
        runId: 'r',
        datasetId: 'd',
        status: 'running',
        total: 58,
        completed: 5,
        currentFileName: '0006.jpg',
        lastCompletedFileName: '0005.jpg'
      })
    ).toBe('Processing 6 of 58 (9%)')

    expect(
      formatCaptionProgressStatus({
        runId: 'r',
        datasetId: 'd',
        status: 'complete',
        total: 58,
        completed: 58,
        currentFileName: null,
        lastCompletedFileName: '0058.jpg'
      })
    ).toBe('Captioning complete · 58 of 58 (100%)')
  })

  it('appends pending queue count while running', () => {
    expect(
      formatCaptionProgressStatus({
        runId: 'r',
        datasetId: 'd',
        status: 'running',
        total: 58,
        completed: 5,
        currentFileName: '0006.jpg',
        lastCompletedFileName: '0005.jpg',
        pendingJobs: 2
      })
    ).toBe('Processing 6 of 58 (9%) · 2 queued')
  })
})
