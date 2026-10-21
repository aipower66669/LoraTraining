import { z } from 'zod'

const numberOrString = z.union([z.number(), z.string()])

export const NetworkSchema = z.object({
  type: z.string().default('lora'),
  linear: z.number().default(32),
  linear_alpha: z.number().default(32)
})

export const SaveSchema = z.object({
  dtype: z.string().default('bf16'),
  save_every: z.number().default(250),
  max_step_saves_to_keep: z.number().default(999999),
  save_format: z.string().default('diffusers'),
  push_to_hub: z.boolean().default(false)
})

export const DatasetEntrySchema = z.object({
  folder_path: z.string(),
  caption_ext: z.string().default('txt'),
  default_caption: z.string().default(''),
  caption_dropout_rate: z.number().default(0),
  shuffle_tokens: z.boolean().default(false),
  cache_latents_to_disk: z.boolean().default(true),
  resolution: z.array(z.number()).default([512]),
  is_reg: z.boolean().default(false),
  network_weight: z.number().default(1),
  flip_x: z.boolean().default(false),
  flip_y: z.boolean().default(false),
  /** AI Toolkit: when false, only images in the dataset root (not subfolders). */
  recursive: z.boolean().default(false)
})

export const TrainSchema = z.object({
  batch_size: z.number().default(1),
  cache_text_embeddings: z.boolean().default(true),
  unload_text_encoder: z.boolean().default(false),
  steps: numberOrString.default(2000),
  gradient_accumulation: z.number().default(1),
  train_unet: z.boolean().default(true),
  train_text_encoder: z.boolean().default(false),
  gradient_checkpointing: z.boolean().default(true),
  noise_scheduler: z.string().default('flowmatch'),
  timestep_type: z.string().default('sigmoid'),
  content_or_style: z.string().default('balanced'),
  loss_type: z.string().default('mse'),
  optimizer: z.string().default('adamw8bit'),
  optimizer_params: z
    .object({
      weight_decay: z.number().default(0.0001)
    })
    .default({ weight_decay: 0.0001 }),
  lr: z.number().default(0.0001),
  ema_config: z
    .object({
      use_ema: z.boolean().default(false),
      ema_decay: z.number().default(0.99)
    })
    .default({ use_ema: false, ema_decay: 0.99 }),
  skip_first_sample: z.boolean().default(true),
  disable_sampling: z.boolean().default(true),
  dtype: z.string().default('bf16'),
  diff_output_preservation: z.boolean().default(false),
  diff_output_preservation_multiplier: z.number().default(1),
  diff_output_preservation_class: z.string().default('CONCEPT_CLASS')
})

export const ModelSchema = z.object({
  name_or_path: z.string(),
  arch: z.string().default('krea2'),
  quantize: z.boolean().default(true),
  qtype: z.string().default('qfloat8'),
  quantize_te: z.boolean().default(true),
  qtype_te: z.string().default('qfloat8'),
  low_vram: z.boolean().default(true),
  layer_offloading: z.boolean().default(true),
  layer_offloading_text_encoder_percent: z.number().default(1),
  layer_offloading_transformer_percent: z.number().default(0.5),
  model_kwargs: z.record(z.unknown()).default({})
})

export const SampleSchema = z.object({
  sampler: z.string().default('flowmatch'),
  sample_every: z.number().default(500),
  width: z.number().default(1024),
  height: z.number().default(1024),
  prompts: z.array(z.string()).default(['CONCEPT_PROMPT']),
  neg: z.string().default(''),
  seed: z.number().default(42),
  walk_seed: z.boolean().default(false),
  guidance_scale: z.number().default(3.5),
  sample_steps: z.number().default(30)
})

export const LoggingSchema = z.object({
  log_every: z.number().default(1),
  use_ui_logger: z.boolean().default(false)
})

export const ProcessConfigSchema = z.object({
  type: z.literal('sd_trainer').default('sd_trainer'),
  name: z.string().optional(),
  training_folder: z.string(),
  device: z.string().default('cuda:0'),
  performance_log_every: z.number().default(10),
  trigger_word: z.string().default(''),
  network: NetworkSchema.default({}),
  save: SaveSchema.default({}),
  datasets: z.array(DatasetEntrySchema).min(1),
  train: TrainSchema.default({}),
  model: ModelSchema,
  sample: SampleSchema.default({}),
  logging: LoggingSchema.default({})
})

/** Inner config object stored on jobs/settings (process[0] fields + name). */
export const TrainingConfigSchema = z.object({
  name: z.string(),
  training_folder: z.string(),
  device: z.string().default('cuda:0'),
  performance_log_every: z.number().default(10),
  trigger_word: z.string().default(''),
  network: NetworkSchema.default({}),
  save: SaveSchema.default({}),
  datasets: z.array(DatasetEntrySchema).min(1),
  train: TrainSchema.default({}),
  model: ModelSchema,
  sample: SampleSchema.default({}),
  logging: LoggingSchema.default({})
})

export type TrainingConfig = z.infer<typeof TrainingConfigSchema>
export type TrainingModel = z.infer<typeof ModelSchema>

/** Stamp library-wide model/VRAM settings onto a job config (YAML write / start). */
export function applyGlobalTrainingModel(
  config: TrainingConfig,
  globalModel: TrainingModel
): TrainingConfig {
  return { ...config, model: structuredClone(globalModel) }
}

export const TrainingYamlEnvelopeSchema = z.object({
  job: z.string().default('extension'),
  config: z.object({
    name: z.string(),
    process: z.array(ProcessConfigSchema).min(1)
  }),
  meta: z
    .object({
      name: z.string().default('[name]'),
      version: z.string().default('1.0')
    })
    .default({ name: '[name]', version: '1.0' })
})

export type TrainingYamlEnvelope = z.infer<typeof TrainingYamlEnvelopeSchema>

export function sanitizeJobName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'job'
}

/** Always `{datasetFolder}/output` — not user-editable. */
export function datasetOutputFolder(folderPath: string): string {
  // Normalize separators so Windows paths never become `...\FluoKawaii/output`.
  const base = folderPath.replace(/[/\\]+$/, '').replace(/\\/g, '/')
  return `${base}/output`
}

export function trainingConfigToEnvelope(config: TrainingConfig): TrainingYamlEnvelope {
  const { name, ...rest } = config
  return {
    job: 'extension',
    config: {
      name,
      process: [
        {
          type: 'sd_trainer',
          name,
          ...rest
        }
      ]
    },
    meta: {
      name: `[${name}]`,
      version: '1.0'
    }
  }
}

export function envelopeToTrainingConfig(envelope: TrainingYamlEnvelope): TrainingConfig {
  const proc = envelope.config.process[0]
  if (!proc) {
    throw new Error('Missing process[0] in training YAML envelope')
  }
  const { type: _type, name: procName, ...rest } = proc
  return TrainingConfigSchema.parse({
    ...rest,
    name: envelope.config.name || procName || 'job'
  })
}

export function resolveTemplateString(
  value: string,
  vars: Record<string, string>
): string {
  let out = value
  for (const [key, replacement] of Object.entries(vars)) {
    out = out.split(key).join(replacement)
  }
  return out
}

export function materialiseTrainingConfig(
  defaults: TrainingConfig,
  opts: {
    jobName: string
    folderPath: string
    trigger: string
    steps?: number
    saveEvery?: number
    outputFolder?: string
    classToken?: string
    samplePrompt?: string
  }
): TrainingConfig {
  const name = sanitizeJobName(opts.jobName)
  const output = opts.outputFolder ?? datasetOutputFolder(opts.folderPath)
  const vars: Record<string, string> = {
    CONCEPT_NAME: name,
    CONCEPT_FOLDER: opts.folderPath,
    CONCEPT_STEPS: String(opts.steps ?? 2000),
    CONCEPT_CLASS: opts.classToken ?? name,
    CONCEPT_PROMPT: opts.samplePrompt ?? `photo of ${opts.trigger || name}`
  }

  const clone = structuredClone(defaults) as TrainingConfig
  clone.name = name
  clone.trigger_word = opts.trigger || clone.trigger_word
  clone.training_folder = resolveTemplateString(clone.training_folder, {
    ...vars,
    'CONCEPT_FOLDER/output': output
  })
  if (clone.training_folder.includes('CONCEPT_FOLDER')) {
    clone.training_folder = output
  }
  if (clone.datasets[0]) {
    clone.datasets[0].folder_path = opts.folderPath
  }
  if (opts.steps != null) {
    clone.train.steps = opts.steps
  } else if (typeof clone.train.steps === 'string') {
    clone.train.steps = 2000
  }
  if (opts.saveEvery != null) {
    clone.save.save_every = opts.saveEvery
  }
  clone.train.diff_output_preservation_class = resolveTemplateString(
    clone.train.diff_output_preservation_class,
    vars
  )
  clone.sample.prompts = clone.sample.prompts.map((p) => resolveTemplateString(p, vars))
  clone.trigger_word = resolveTemplateString(clone.trigger_word, vars)
  if (clone.trigger_word === 'CONCEPT_NAME' || !clone.trigger_word) {
    clone.trigger_word = opts.trigger || name
  }
  return TrainingConfigSchema.parse(clone)
}
