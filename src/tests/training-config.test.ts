import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'
import {
  TrainingYamlEnvelopeSchema,
  envelopeToTrainingConfig,
  materialiseTrainingConfig,
  trainingConfigToEnvelope,
  sanitizeJobName,
  applyGlobalTrainingModel
} from '@shared/schemas/training-config'
import { createDefaultTrainingConfig } from '@shared/schemas/settings'

describe('training config yaml', () => {
  it('round-trips a resolved fixture', () => {
    const samplePath = resolve(__dirname, '../../reference/config-sample.yaml')
    const raw = readFileSync(samplePath, 'utf8').replace('CONCEPT_STEPS', '20')
    const envelope = TrainingYamlEnvelopeSchema.parse(parse(raw))
    const config = envelopeToTrainingConfig(envelope)
    expect(config.train.steps).toBe(20)
    const back = trainingConfigToEnvelope(config)
    const yaml = stringify(back)
    const again = TrainingYamlEnvelopeSchema.parse(parse(yaml))
    expect(again.config.name).toBe(config.name)
    expect(again.config.process[0]?.datasets[0]?.folder_path).toBe(config.datasets[0]?.folder_path)
  })

  it('materialises dataset paths and trigger', () => {
    const defaults = createDefaultTrainingConfig()
    const out = materialiseTrainingConfig(defaults, {
      jobName: 'My Concept!',
      folderPath: 'Z:\\datasets\\concept',
      trigger: 'ohwx concept',
      steps: 20,
      saveEvery: 100
    })
    expect(sanitizeJobName('My Concept!')).toBe('My_Concept')
    expect(out.name).toBe('My_Concept')
    expect(out.datasets[0]?.folder_path).toBe('Z:\\datasets\\concept')
    expect(out.training_folder.replace(/\\/g, '/')).toContain('datasets/concept/output')
    expect(out.trigger_word).toBe('ohwx concept')
    expect(out.train.steps).toBe(20)
    expect(out.save.save_every).toBe(100)
  })

  it('applyGlobalTrainingModel replaces the job model block', () => {
    const defaults = createDefaultTrainingConfig()
    const job = materialiseTrainingConfig(defaults, {
      jobName: 'x',
      folderPath: 'Z:\\d',
      trigger: 't'
    })
    job.model.name_or_path = 'old.safetensors'
    job.model.low_vram = false
    const global = { ...defaults.model, name_or_path: 'F:\\new.safetensors', low_vram: true }
    const out = applyGlobalTrainingModel(job, global)
    expect(out.model.name_or_path).toBe('F:\\new.safetensors')
    expect(out.model.low_vram).toBe(true)
    expect(job.model.name_or_path).toBe('old.safetensors')
  })
})
