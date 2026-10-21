import { z } from 'zod'
import { TrainingConfigSchema } from './training-config'

export const JobStatusSchema = z.enum([
  'draft',
  'queued',
  'running',
  'paused',
  'complete',
  'failed',
  'cancelled'
])

export const JobProgressSchema = z
  .object({
    currentStep: z.number().optional(),
    totalSteps: z.number().optional(),
    percent: z.number().optional(),
    pass: z.number().optional(),
    elapsedMs: z.number(),
    pausedMs: z.number(),
    etaMs: z.number().optional(),
    avgStepMs: z.number().optional(),
    stepsPerSecond: z.number().optional(),
    secondsPerStep: z.number().optional(),
    learningRate: z.number().optional(),
    loss: z.number().optional(),
    lastMessage: z.string().optional(),
    updatedAt: z.string()
  })
  .nullable()

export const JobRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  datasetId: z.string(),
  status: JobStatusSchema.default('draft'),
  /** User marked finished / no longer active; independent of status. */
  archived: z.boolean().default(false),
  config: TrainingConfigSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable().default(null),
  finishedAt: z.string().nullable().default(null),
  yamlPath: z.string().nullable().default(null),
  progress: JobProgressSchema.default(null),
  lastError: z.string().nullable().default(null),
  queueOrder: z.number().nullable().default(null)
})

export type JobRecord = z.infer<typeof JobRecordSchema>
