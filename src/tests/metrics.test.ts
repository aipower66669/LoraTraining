import { describe, expect, it } from 'vitest'
import {
  createEmptyProgress,
  parseMetricsLine
} from '@main/progress/parser'
import { formatProgressAction, parseActionLabel } from '@shared/progress-action'

describe('metrics parser', () => {
  it('parses step loss lr and timing', () => {
    const started = Date.now() - 5000
    let p = createEmptyProgress(100)
    p = parseMetricsLine('Step 10/100 loss=0.42 lr=1e-4 1.5s/it', p, started)
    expect(p.currentStep).toBe(10)
    expect(p.totalSteps).toBe(100)
    expect(p.loss).toBeCloseTo(0.42)
    expect(p.learningRate).toBeCloseTo(1e-4)
    expect(p.secondsPerStep).toBeCloseTo(1.5)
    expect(p.percent).toBe(10)
  })

  it('parses AI Toolkit tqdm progress lines', () => {
    const started = Date.now() - 5000
    const line =
      'DisposableDiaper_r32:  4%|3          | 105/3000 [05:24<2:29:08,  3.09s/it, lr: 1.0e-04 loss: 6.829e-02]'
    const p = parseMetricsLine(line, createEmptyProgress(3000), started)
    // 105/3000 → 3.5% (from steps, not tqdm's printed 4%)
    expect(p.percent).toBeCloseTo(3.5, 5)
    expect(p.pass).toBe(3)
    expect(p.currentStep).toBe(105)
    expect(p.totalSteps).toBe(3000)
    expect(p.etaMs).toBe((2 * 3600 + 29 * 60 + 8) * 1000)
    expect(p.secondsPerStep).toBeCloseTo(3.09)
    expect(p.loss).toBeCloseTo(6.829e-2)
    expect(p.learningRate).toBeCloseTo(1e-4)
  })

  it('starts as Initializing and only changes on known markers', () => {
    const started = Date.now()
    let p = createEmptyProgress()
    expect(p.lastMessage).toBe('Initializing')
    expect(formatProgressAction(p)).toBe('Initializing')

    p = parseMetricsLine('hello world noise', p, started)
    expect(p.lastMessage).toBe('Initializing')

    p = parseMetricsLine('Caching text embeddings to disk for Z:\\data', p, started)
    expect(p.lastMessage).toBe('Caching text embeddings to disk')

    p = parseMetricsLine('12%|█         | 28/234 [00:10<01:00, 2.00it/s]', p, started)
    expect(p.lastMessage).toBe('Caching text embeddings to disk')
    expect(formatProgressAction(p)).toBe('Caching text embeddings to disk')

    p = parseMetricsLine('Caching latents to disk', p, started)
    expect(p.lastMessage).toBe('Caching latents to disk')

    p = parseMetricsLine('***************************************', p, started)
    expect(p.lastMessage).toBe('Training')
  })

  it('never displays raw tqdm as the action label', () => {
    const started = Date.now()
    const tqdm =
      '6%|5          | 165/3000 [09:00<2:34:42, 3.27s/it, lr: 1.0e-04 loss: 5.877e-02]'
    let p = createEmptyProgress(3000)
    // Simulate stale lastMessage from an older build.
    p = { ...p, lastMessage: tqdm }
    expect(formatProgressAction(p)).toBe('')
    p = parseMetricsLine(tqdm, p, started)
    expect(p.lastMessage).toBe('Training')
    expect(formatProgressAction(p)).toBe('Training')
  })
})

describe('progress-action markers', () => {
  it('matches fixed phase strings', () => {
    expect(parseActionLabel('Quantizing transformer…')).toBe('Quantizing transformer')
    expect(parseActionLabel('Loading weights from checkpoint')).toBe('Loading weights')
    expect(parseActionLabel('Preprocessing image dimensions')).toBe(
      'Preprocessing image dimensions'
    )
    expect(parseActionLabel('***************************************')).toBe('Training')
    expect(parseActionLabel('********************')).toBe('Training')
    expect(parseActionLabel('random log')).toBeNull()
    expect(
      parseActionLabel(
        '6%|5 | 165/3000 [09:00<2:34:42, 3.27s/it, lr: 1.0e-04 loss: 5.877e-02]'
      )
    ).toBeNull()
  })
})
