import { describe, expect, it } from 'vitest'
import { applySharedTrainingConfigChange, deepEqual } from '../shared/job-multi-edit'
import type { TrainingConfig } from '../shared/schemas/training-config'

function baseConfig(overrides: Partial<TrainingConfig> = {}): TrainingConfig {
  return {
    name: 'JobA',
    training_folder: 'Z:/out/A',
    device: 'cuda:0',
    performance_log_every: 10,
    trigger_word: 'tokA',
    network: { type: 'lora', linear: 16, linear_alpha: 16 },
    save: {
      dtype: 'bf16',
      save_every: 250,
      max_step_saves_to_keep: 999999,
      save_format: 'diffusers',
      push_to_hub: false
    },
    datasets: [
      {
        folder_path: 'Z:/ds/A',
        caption_ext: 'txt',
        default_caption: '',
        caption_dropout_rate: 0,
        shuffle_tokens: false,
        cache_latents_to_disk: true,
        resolution: [512],
        is_reg: false,
        network_weight: 1,
        flip_x: false,
        flip_y: false,
        recursive: false
      }
    ],
    train: {
      batch_size: 1,
      cache_text_embeddings: true,
      unload_text_encoder: false,
      steps: 2000,
      gradient_accumulation: 1,
      train_unet: true,
      train_text_encoder: false,
      gradient_checkpointing: true,
      noise_scheduler: 'flowmatch',
      timestep_type: 'sigmoid',
      content_or_style: 'balanced',
      loss_type: 'mse',
      optimizer: 'adamw8bit',
      optimizer_params: { weight_decay: 0.0001 },
      lr: 0.0001,
      ema_config: { use_ema: false, ema_decay: 0.99 },
      skip_first_sample: true,
      disable_sampling: true,
      dtype: 'bf16',
      diff_output_preservation: false,
      diff_output_preservation_multiplier: 1,
      diff_output_preservation_class: 'CONCEPT_CLASS'
    },
    model: {
      name_or_path: 'model.safetensors',
      arch: 'krea2',
      quantize: true,
      qtype: 'qfloat8',
      quantize_te: true,
      qtype_te: 'qfloat8',
      low_vram: true,
      layer_offloading: true,
      layer_offloading_text_encoder_percent: 1,
      layer_offloading_transformer_percent: 0.5,
      model_kwargs: {}
    },
    sample: {
      sampler: 'flowmatch',
      sample_every: 500,
      width: 1024,
      height: 1024,
      prompts: ['p'],
      neg: '',
      seed: 42,
      walk_seed: false,
      guidance_scale: 3.5,
      sample_steps: 30
    },
    logging: { log_every: 1, use_ui_logger: false },
    ...overrides
  }
}

describe('applySharedTrainingConfigChange', () => {
  it('applies only changed train steps to every target', () => {
    const a = baseConfig({ name: 'A', trigger_word: 'ta', training_folder: 'out/A' })
    a.datasets[0]!.folder_path = 'ds/A'
    a.train.steps = 1000

    const b = baseConfig({ name: 'B', trigger_word: 'tb', training_folder: 'out/B' })
    b.datasets[0]!.folder_path = 'ds/B'
    b.train.steps = 3000
    b.train.lr = 0.0002

    const before = structuredClone(a)
    const after = { ...before, train: { ...before.train, steps: 5000 } }

    const [na, nb] = applySharedTrainingConfigChange([a, b], before, after)
    expect(na!.train.steps).toBe(5000)
    expect(nb!.train.steps).toBe(5000)
    expect(nb!.train.lr).toBe(0.0002)
    expect(na!.name).toBe('A')
    expect(nb!.name).toBe('B')
    expect(na!.trigger_word).toBe('ta')
    expect(nb!.trigger_word).toBe('tb')
    expect(na!.datasets[0]!.folder_path).toBe('ds/A')
    expect(nb!.datasets[0]!.folder_path).toBe('ds/B')
    expect(na!.training_folder).toBe('out/A')
    expect(nb!.training_folder).toBe('out/B')
  })

  it('does not overwrite identity when form emits name/trigger changes', () => {
    const a = baseConfig({ name: 'A', trigger_word: 'ta' })
    const before = structuredClone(a)
    const after = { ...before, name: 'HACK', trigger_word: 'nope', train: { ...before.train, lr: 0.001 } }
    const [na] = applySharedTrainingConfigChange([a], before, after)
    expect(na!.name).toBe('A')
    expect(na!.trigger_word).toBe('ta')
    expect(na!.train.lr).toBe(0.001)
  })

  it('does not apply model / VRAM changes (those are library-wide settings)', () => {
    const a = baseConfig()
    a.model.low_vram = false
    const before = structuredClone(a)
    const after = {
      ...before,
      model: { ...before.model, low_vram: true, layer_offloading_transformer_percent: 0.9 }
    }
    const [na] = applySharedTrainingConfigChange([a], before, after)
    expect(na!.model.low_vram).toBe(false)
    expect(na!.model.layer_offloading_transformer_percent).toBe(0.5)
  })

  it('deepEqual matches nested structures', () => {
    const a = baseConfig()
    const b = structuredClone(a)
    expect(deepEqual(a, b)).toBe(true)
    b.train.steps = 99
    expect(deepEqual(a, b)).toBe(false)
  })
})
