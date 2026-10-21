import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

process.env.LORA_LOG_LEVEL = 'silent'

const listDatasets = vi.fn()
const getDatasetRecord = vi.fn()
const getValidationSetsStatus = vi.fn()
const listStressPreviews = vi.fn()
const listWeightPreviews = vi.fn()
const startValidation = vi.fn()
const startWeightValidation = vi.fn()
const startStressTest = vi.fn()

vi.mock('../main/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

vi.mock('../main/datasets/store', () => ({
  listDatasets: (...args: unknown[]) => listDatasets(...args),
  getDatasetRecord: (...args: unknown[]) => getDatasetRecord(...args)
}))

vi.mock('../main/comfy/nextValidationLora', () => ({
  getValidationSetsStatus: (...args: unknown[]) => getValidationSetsStatus(...args)
}))

vi.mock('../main/comfy/stressSets', () => ({
  listStressPreviews: (...args: unknown[]) => listStressPreviews(...args)
}))

vi.mock('../main/comfy/weightSets', () => ({
  listWeightPreviews: (...args: unknown[]) => listWeightPreviews(...args)
}))

vi.mock('../main/comfy/validationQueue', () => ({
  startValidation: (...args: unknown[]) => startValidation(...args)
}))

vi.mock('../main/comfy/weightQueue', () => ({
  startWeightValidation: (...args: unknown[]) => startWeightValidation(...args)
}))

vi.mock('../main/comfy/stressQueue', () => ({
  startStressTest: (...args: unknown[]) => startStressTest(...args)
}))

import {
  beginPreviewContinuum,
  findNextPreviewWork,
  onPreviewRunFinished,
  stopPreviewContinuum
} from '../main/comfy/previewContinuum'

function weightSetNeedingWork() {
  return {
    checkpointFileName: 'lora.safetensors',
    prompt: '',
    seed: 1,
    styleIndex: 0,
    validationModel: 'Default',
    weightMin: 0.6,
    weightMax: 1.0,
    weightStep: 0.2,
    existingCopyPolicy: 'reuse_if_identical_error_if_different'
  }
}

function stressSetNeedingWork() {
  return {
    checkpointFileName: 'lora.safetensors',
    models: ['modelA.safetensors'],
    prompt: '',
    seed: 1,
    loraWeight: 1,
    styleIndex: 0,
    existingCopyPolicy: 'reuse_if_identical_error_if_different'
  }
}

describe('preview continuum', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    stopPreviewContinuum()
    listDatasets.mockResolvedValue([
      { id: 'a', trained: true, folderPath: '/a' },
      { id: 'b', trained: true, folderPath: '/b' }
    ])
    getDatasetRecord.mockImplementation(async (id: string) => ({
      id,
      validationSets: [{}, {}],
      weightSets: [weightSetNeedingWork()],
      stressTestSets: [stressSetNeedingWork()]
    }))
    getValidationSetsStatus.mockImplementation(async (folder: string) => {
      if (folder === '/a') {
        return { complete: false, safetensorsCount: 2, keepInComfyCount: 2 }
      }
      return { complete: true, safetensorsCount: 2, keepInComfyCount: 2 }
    })
    listWeightPreviews.mockResolvedValue([])
    listStressPreviews.mockResolvedValue([])
    startValidation.mockResolvedValue({ started: true })
    startWeightValidation.mockResolvedValue({ started: true })
    startStressTest.mockResolvedValue({ started: true })
  })

  afterEach(() => {
    stopPreviewContinuum()
    vi.useRealTimers()
  })

  it('findNextPreviewWork prefers unfinished validation on the current dataset', async () => {
    const next = await findNextPreviewWork({ preferDatasetId: 'a' })
    expect(next).toEqual({ datasetId: 'a', kind: 'validation' })
  })

  it('findNextPreviewWork advances to weight when validation is complete', async () => {
    getValidationSetsStatus.mockResolvedValue({
      complete: true,
      safetensorsCount: 2,
      keepInComfyCount: 2
    })
    const next = await findNextPreviewWork({ preferDatasetId: 'a' })
    expect(next).toEqual({ datasetId: 'a', kind: 'weight' })
  })

  it('findNextPreviewWork advances to stress when validation and weight are complete', async () => {
    getValidationSetsStatus.mockResolvedValue({
      complete: true,
      safetensorsCount: 2,
      keepInComfyCount: 2
    })
    listWeightPreviews.mockResolvedValue([
      { stem: 'lora_0.6' },
      { stem: 'lora_0.8' },
      { stem: 'lora_1.0' }
    ])
    const next = await findNextPreviewWork({ preferDatasetId: 'a' })
    expect(next).toEqual({ datasetId: 'a', kind: 'stress' })
  })

  it('after validation done, continuum starts weight before stress', async () => {
    beginPreviewContinuum()
    // Steps still looks incomplete — preferKind must still hand off to Weight.
    getValidationSetsStatus.mockResolvedValue({
      complete: false,
      safetensorsCount: 2,
      keepInComfyCount: 2
    })

    const finished = onPreviewRunFinished({ datasetId: 'a', kind: 'validation' }, 'done')
    await vi.advanceTimersByTimeAsync(800)
    await finished
    expect(startWeightValidation).toHaveBeenCalledWith({ datasetId: 'a', chain: true })
    expect(startStressTest).not.toHaveBeenCalled()
    expect(startValidation).not.toHaveBeenCalled()
  })

  it('after weight done, continuum starts stress on the same dataset', async () => {
    beginPreviewContinuum()
    getValidationSetsStatus.mockResolvedValue({
      complete: true,
      safetensorsCount: 2,
      keepInComfyCount: 2
    })
    listWeightPreviews.mockResolvedValue([
      { stem: 'lora_0.6' },
      { stem: 'lora_0.8' },
      { stem: 'lora_1.0' }
    ])

    const finished = onPreviewRunFinished({ datasetId: 'a', kind: 'weight' }, 'done')
    await vi.advanceTimersByTimeAsync(800)
    await finished
    expect(startStressTest).toHaveBeenCalledWith({ datasetId: 'a', chain: true })
    expect(startWeightValidation).not.toHaveBeenCalled()
  })

  it('after validation done with remaining gaps, continuum re-runs validation', async () => {
    beginPreviewContinuum()
    // No Weight/Stress work so preferKind=weight misses and we settle/retry Steps.
    getDatasetRecord.mockImplementation(async (id: string) => ({
      id,
      validationSets: [{}, {}],
      weightSets: [{ ...weightSetNeedingWork(), checkpointFileName: null }],
      stressTestSets: [{ ...stressSetNeedingWork(), models: [] }]
    }))
    getValidationSetsStatus.mockImplementation(async (folder: string) => {
      if (folder === '/a') {
        return { complete: false, safetensorsCount: 2, keepInComfyCount: 2 }
      }
      return { complete: true, safetensorsCount: 2, keepInComfyCount: 2 }
    })

    const finished = onPreviewRunFinished({ datasetId: 'a', kind: 'validation' }, 'done')
    // Two same-item settles, then start on the third scan.
    await vi.advanceTimersByTimeAsync(750)
    await vi.advanceTimersByTimeAsync(750)
    await vi.advanceTimersByTimeAsync(750)
    await finished
    expect(startValidation).toHaveBeenCalledWith({ datasetId: 'a', chain: true })
  })

  it('after validation done, continuum continues to another dataset’s validation', async () => {
    beginPreviewContinuum()
    // A complete for validation + weight + stress; B still needs validation
    getValidationSetsStatus.mockImplementation(async (folder: string) => {
      if (folder === '/b') {
        return { complete: false, safetensorsCount: 2, keepInComfyCount: 2 }
      }
      return { complete: true, safetensorsCount: 2, keepInComfyCount: 2 }
    })
    listWeightPreviews.mockResolvedValue([
      { stem: 'lora_0.6' },
      { stem: 'lora_0.8' },
      { stem: 'lora_1.0' }
    ])
    listStressPreviews.mockResolvedValue([{ stem: 'modela' }])

    const finished = onPreviewRunFinished({ datasetId: 'a', kind: 'validation' }, 'done')
    await vi.advanceTimersByTimeAsync(800)
    await finished
    expect(startValidation).toHaveBeenCalledWith({ datasetId: 'b', chain: true })
  })
})
