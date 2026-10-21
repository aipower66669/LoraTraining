import { describe, expect, it } from 'vitest'
import {
  checkpointStepFromName,
  compareCheckpointsByStep,
  expectedCheckpointSteps,
  formatCheckpointStep,
  hasOnDiskSafetensorCheckpoints,
  inferCheckpointStepPad,
  latestCheckpointStepFromNames,
  pendingFurtherCheckpointSteps,
  planFinalCheckpointRename
} from '@shared/checkpoints'

describe('hasOnDiskSafetensorCheckpoints', () => {
  it('ignores synthetic pending placeholders from listOutputs', () => {
    expect(
      hasOnDiskSafetensorCheckpoints([
        {
          fileName: 'Latex_000000500.safetensors',
          pending: true
        },
        {
          fileName: 'Latex_000001000.safetensors',
          pending: true
        }
      ])
    ).toBe(false)
  })

  it('is true when a real on-disk safetensors exists', () => {
    expect(
      hasOnDiskSafetensorCheckpoints([
        { fileName: 'Latex_000000500.safetensors', pending: true },
        { fileName: 'Latex_000000250.safetensors' }
      ])
    ).toBe(true)
  })
})

describe('checkpoint step sorting', () => {
  it('parses zero-padded step suffix', () => {
    expect(checkpointStepFromName('job_000000500.safetensors')).toBe(500)
    expect(checkpointStepFromName('job_LoRA_000001000.safetensors')).toBe(1000)
    expect(checkpointStepFromName('FluoKawaii_000000250.safetensors')).toBe(250)
    expect(checkpointStepFromName('FluoKawaii_000000500.safetensors')).toBe(500)
  })

  it('picks the highest numbered checkpoint step', () => {
    expect(
      latestCheckpointStepFromNames([
        'FluoKawaii_000000250.safetensors',
        'FluoKawaii_000000500.safetensors'
      ])
    ).toBe(500)
    expect(
      latestCheckpointStepFromNames([
        'x_000000250.safetensors',
        'x.safetensors',
        'x_000003000.safetensors',
        'x_000002750.safetensors'
      ])
    ).toBe(3000)
    expect(latestCheckpointStepFromNames(['x.safetensors'])).toBeNull()
  })

  it('sorts ascending by step', () => {
    const items = [
      { fileName: 'x_000001000.safetensors', relativePath: 'x_000001000.safetensors' },
      { fileName: 'x_000000250.safetensors', relativePath: 'x_000000250.safetensors' },
      { fileName: 'x_000000500.safetensors', relativePath: 'x_000000500.safetensors' }
    ]
    items.sort(compareCheckpointsByStep)
    expect(items.map((i) => checkpointStepFromName(i.fileName))).toEqual([250, 500, 1000])
  })
})

describe('planFinalCheckpointRename', () => {
  it('renames unnumbered final to total steps with inferred pad', () => {
    const plan = planFinalCheckpointRename({
      loraName: 'loraname',
      totalSteps: 1000,
      fileNames: [
        'loraname_000000250.safetensors',
        'loraname_000000500.safetensors',
        'loraname_000000750.safetensors',
        'loraname.safetensors',
        'loraname.jpg'
      ]
    })
    expect(plan).toEqual({
      fromStem: 'loraname',
      toStem: 'loraname_000001000',
      step: 1000
    })
  })

  it('skips when final missing or target already exists', () => {
    expect(
      planFinalCheckpointRename({
        loraName: 'loraname',
        totalSteps: 1000,
        fileNames: ['loraname_000000250.safetensors']
      })
    ).toBeNull()
    expect(
      planFinalCheckpointRename({
        loraName: 'loraname',
        totalSteps: 1000,
        fileNames: ['loraname.safetensors', 'loraname_000001000.safetensors']
      })
    ).toBeNull()
  })

  it('formats and infers pad width', () => {
    expect(formatCheckpointStep(1000)).toBe('000001000')
    expect(inferCheckpointStepPad(['a_000000250.safetensors'])).toBe(9)
    expect(inferCheckpointStepPad([])).toBe(9)
  })
})

describe('expected / pending further checkpoint steps', () => {
  it('includes save_every multiples and the final total', () => {
    expect(expectedCheckpointSteps(4000, 500)).toEqual([
      500, 1000, 1500, 2000, 2500, 3000, 3500, 4000
    ])
    expect(expectedCheckpointSteps(1000, 300)).toEqual([300, 600, 900, 1000])
  })

  it('only lists steps after the latest on-disk checkpoint', () => {
    expect(
      pendingFurtherCheckpointSteps({
        totalSteps: 4000,
        saveEvery: 500,
        latestExistingStep: 3000
      })
    ).toEqual([3500, 4000])
    expect(
      pendingFurtherCheckpointSteps({
        totalSteps: 3000,
        saveEvery: 500,
        latestExistingStep: 3000
      })
    ).toEqual([])
  })
})
