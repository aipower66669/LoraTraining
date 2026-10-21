import { describe, expect, it } from 'vitest'
import { buildStressSetPreviews } from '@shared/stress-set-previews'
import { modelPreviewStemMap } from '@shared/stress-sets'

describe('buildStressSetPreviews', () => {
  it('orders by selected models and appends live progress when new', () => {
    const models = [
      'models/model_a.safetensors',
      'models/model_b.safetensors',
      'models/model_c.safetensors'
    ]
    const stems = modelPreviewStemMap(models)
    const stemA = stems.get(models[0]!)!
    const stemB = stems.get(models[1]!)!
    const stemC = stems.get(models[2]!)!
    const list = buildStressSetPreviews({
      diskPreviews: [
        { stem: stemB, relativePath: `output/Stress 1/${stemB}.jpg` },
        { stem: stemA, relativePath: `output/Stress 1/${stemA}.jpg` }
      ],
      models,
      datasetId: 'd1',
      setIndex: 0,
      progress: {
        status: 'running',
        datasetId: 'd1',
        setIndex: 0,
        setLabel: 'Stress 1',
        jobsCompleted: 3,
        lastPreviewRelativePath: `output/Stress 1/${stemC}.jpg`,
        lastPreviewFileName: stemC,
        currentModel: models[2]!
      }
    })
    expect(list.map((p) => p.stem)).toEqual([stemA, stemB, stemC])
    expect(list[2]?.bust).toContain('3:')
  })

  it('updates bust when live preview already on disk', () => {
    const models = ['models/model_a.safetensors']
    const stemA = modelPreviewStemMap(models).get(models[0]!)!
    const list = buildStressSetPreviews({
      diskPreviews: [{ stem: stemA, relativePath: `output/Stress 1/${stemA}.jpg` }],
      models,
      datasetId: 'd1',
      setIndex: 0,
      progress: {
        status: 'running',
        datasetId: 'd1',
        setIndex: 0,
        setLabel: 'Stress 1',
        jobsCompleted: 2,
        lastPreviewRelativePath: `output/Stress 1/${stemA}.jpg`,
        lastPreviewFileName: stemA
      }
    })
    expect(list).toHaveLength(1)
    expect(list[0]?.bust).toBe(`2:output/Stress 1/${stemA}.jpg`)
  })

  it('does not resurrect lastPreview after the run finishes', () => {
    const models = ['models/model_a.safetensors', 'models/model_b.safetensors']
    const stems = modelPreviewStemMap(models)
    const stemA = stems.get(models[0]!)!
    const stemB = stems.get(models[1]!)!
    const list = buildStressSetPreviews({
      diskPreviews: [{ stem: stemA, relativePath: `output/Stress 1/${stemA}.jpg` }],
      models,
      datasetId: 'd1',
      setIndex: 0,
      progress: {
        status: 'done',
        datasetId: 'd1',
        setIndex: 0,
        setLabel: 'Stress 1',
        jobsCompleted: 2,
        lastPreviewRelativePath: `output/Stress 1/${stemB}.jpg`,
        lastPreviewFileName: stemB
      }
    })
    expect(list.map((p) => p.stem)).toEqual([stemA])
  })
})
