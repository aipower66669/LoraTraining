import { stringify, parse } from 'yaml'
import {
  TrainingConfigSchema,
  trainingConfigToEnvelope,
  envelopeToTrainingConfig,
  type TrainingConfig,
  TrainingYamlEnvelopeSchema
} from '@shared/schemas/training-config'

export function trainingConfigToYaml(config: TrainingConfig): string {
  const envelope = trainingConfigToEnvelope(TrainingConfigSchema.parse(config))
  return stringify(envelope)
}

export function yamlToTrainingConfig(yamlText: string): TrainingConfig {
  const raw = parse(yamlText) as unknown
  const envelope = TrainingYamlEnvelopeSchema.parse(raw)
  return envelopeToTrainingConfig(envelope)
}

export { parse as parseYaml, stringify as stringifyYaml }
