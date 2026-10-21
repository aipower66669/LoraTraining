import { z } from 'zod'
import { TrainingConfigSchema, type TrainingConfig } from './training-config'
import { DEFAULT_COMFY_CONNECTION } from '../comfy'
import { BUNDLED_JOYCAPTION_SCRIPT } from '../joycaption'
import { UpscaleConfigSchema } from '../upscale-config'
import { DiversifyConfigSchema } from '../diversify-config'

/** Last-used Validation Weight sweep bounds (min / max / step). */
export const LastWeightRangeSchema = z.object({
  weightMin: z.number().default(0.6),
  weightMax: z.number().default(1.4),
  weightStep: z.number().default(0.2)
})

export const JoyCaptionToolsSchema = z.object({
  workingDirectory: z.string().default(''),
  pythonExecutable: z.string().default(''),
  /** Defaults to the captioner shipped under `resources/joycaption/`. */
  scriptPath: z.string().default(BUNDLED_JOYCAPTION_SCRIPT),
  extraArgs: z.array(z.string()).default([]),
  invocationMode: z.enum(['direct', 'cmd']).default('direct')
})

export const AiToolkitToolsSchema = z.object({
  workingDirectory: z.string().default(''),
  pythonExecutable: z.string().default(''),
  runScript: z.string().default('run.py'),
  extraArgs: z.array(z.string()).default([])
})

export const ComfySettingsSchema = z.object({
  host: z.string().default(DEFAULT_COMFY_CONNECTION.host),
  port: z.number().int().min(1).max(65535).default(DEFAULT_COMFY_CONNECTION.port),
  secure: z.boolean().default(DEFAULT_COMFY_CONNECTION.secure),
  /** Absolute path to ComfyUI `models/loras` (or equivalent). Empty = use Comfy’s configured root at runtime. */
  lorasFolder: z.string().default(''),
  /** Subfolder under lorasFolder for validation copies. */
  validationLoraSubfolder: z.string().default('!Testing'),
  /**
   * Checkpoint filename (as listed by ComfyUI) used when a dataset’s validation
   * model is “Default”. Empty = do not override the workflow’s loader.
   */
  defaultValidationModel: z.string().default(''),
  /**
   * Absolute path to a ComfyUI launcher (.bat / .exe). Used when Validation or
   * Upscale needs ComfyUI and the server is unreachable — launched externally
   * so it survives an app restart.
   */
  launchCommand: z.string().default(''),
  /** Absolute path to a Dynamic Prompts / wildcards library folder.
   * Used for `__wildcard__` autocomplete in Validate / Stress / Upscale prompts.
   */
  wildcardLibraryFolder: z.string().default(''),
  /**
   * ComfyUI installation root (folder that contains `custom_nodes/`).
   * Used to install bundled LT custom nodes. Often inferred from LoRAs path.
   */
  comfyRoot: z.string().default('')
})

export const QueuePrefsSchema = z.object({
  allowConcurrentCaptioning: z.boolean().default(false),
  /**
   * When true (default), a failed job is removed from the FIFO and the next
   * queued job starts automatically — same as after a successful complete.
   * Set false to stop the queue on failure (avoids back-to-back OOM on bad runs).
   */
  continueOnFailure: z.boolean().default(true)
})

/**
 * Persisted in Electron AppData as the ONLY durable app-level state (`app-config.json`).
 * Deliberately minimal: AppData is disposable (wiped by uninstall/OS profile reset),
 * so nothing that matters for restoring a workspace — and nothing potentially
 * sensitive — lives here. It exists purely to bootstrap "where is my library".
 */
export const AppPointerSchema = z.object({
  version: z.literal(1).default(1),
  /**
   * Absolute path to the training library root (categories.json + category folders).
   * Empty = library not configured yet.
   */
  libraryRoot: z.string().default('')
})

export type AppPointer = z.infer<typeof AppPointerSchema>

/**
 * Everything else: persisted at `{libraryRoot}/settings.json`, so it travels with
 * (and is restored by) a library backup rather than living in disposable AppData.
 * Includes `lastValidationPrompt`, which can hold private prompt text.
 */
export const LibrarySettingsSchema = z.object({
  version: z.literal(1).default(1),
  tools: z
    .object({
      joyCaption: JoyCaptionToolsSchema.default({}),
      aiToolkit: AiToolkitToolsSchema.default({}),
      /** Full path to Photoshop.exe — persisted; re-prompted if missing/invalid. */
      photoshopExecutable: z.string().default('')
    })
    .default({}),
  comfy: ComfySettingsSchema.default({}),
  queue: QueuePrefsSchema.default({}),
  defaultTrainingConfig: TrainingConfigSchema,
  recentDatasetIds: z.array(z.string()).default([]),
  recentJobIds: z.array(z.string()).default([]),
  /** Prefill Set 1 prompt on new datasets (updated when a validation run starts). */
  lastValidationPrompt: z.string().default(''),
  /**
   * Last ticked Comfy models for Model Stress-Testing.
   * Updated whenever the user clicks **Apply** in Select models… — seeds new
   * datasets’ Stress 1 and new stress sets until the next Apply.
   */
  lastStressModels: z.array(z.string()).default([]),
  /**
   * Last Validation Weight min / max / step — seeds a new dataset’s first
   * weight set / remembered when updating a set’s range.
   */
  lastWeightRange: LastWeightRangeSchema.default({}),
  /** Last Image Scraper source (Pinterest vs Google Images). */
  lastImageScraperSource: z.enum(['pinterest', 'google']).default('pinterest'),
  /**
   * Last Upscale/Detail field values — carried forward when opening Upscale on
   * the next image (prompt falls back to that image's caption when empty).
   */
  lastUpscaleConfig: UpscaleConfigSchema.default({}),
  /** Last Diversify · Context field values. */
  lastDiversifyContextConfig: DiversifyConfigSchema.default({}),
  /** Last Diversify · Expression field values. */
  lastDiversifyExpressionConfig: DiversifyConfigSchema.default({}),
  /**
   * Folder that contains electron-builder NSIS installers
   * (`LoraTraining Setup X.Y.Z.exe`), typically the repo `release/` output.
   * Used by Settings → App updates to check / launch an installer.
   */
  updateCheckFolder: z.string().default(''),
  /**
   * Opt-in image edit / Upscale history in NTFS alternate data streams.
   * Off = save over the image body like a conventional editor.
   */
  imageVersionsEnabled: z.boolean().default(false),
  /**
   * Set after a successful full-library `{file}.original` → ADS migration pass.
   * Empty = not yet completed (retry on next launch).
   */
  imageVersionsAdsMigratedAt: z.string().default('')
})

export type LibrarySettings = z.infer<typeof LibrarySettingsSchema>

/**
 * Merged runtime shape used everywhere outside the settings-store persistence layer
 * (IPC contract, preload, renderer, other main-process modules). Only `settings/store.ts`
 * knows this is actually backed by two files on disk (AppData pointer + library settings).
 */
export const SettingsSchema = AppPointerSchema.merge(LibrarySettingsSchema)

export type AppSettings = z.infer<typeof SettingsSchema>
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>

export const SettingsPatchSchema = z
  .object({
    libraryRoot: z.string().optional(),
    tools: z
      .object({
        joyCaption: JoyCaptionToolsSchema.partial().optional(),
        aiToolkit: AiToolkitToolsSchema.partial().optional(),
        photoshopExecutable: z.string().optional()
      })
      .optional(),
    comfy: ComfySettingsSchema.partial().optional(),
    queue: QueuePrefsSchema.partial().optional(),
    defaultTrainingConfig: TrainingConfigSchema.partial().optional(),
    recentDatasetIds: z.array(z.string()).optional(),
    recentJobIds: z.array(z.string()).optional(),
    lastValidationPrompt: z.string().optional(),
    lastStressModels: z.array(z.string()).optional(),
    lastWeightRange: LastWeightRangeSchema.partial().optional(),
    lastImageScraperSource: z.enum(['pinterest', 'google']).optional(),
    lastUpscaleConfig: UpscaleConfigSchema.partial().optional(),
    lastDiversifyContextConfig: DiversifyConfigSchema.partial().optional(),
    lastDiversifyExpressionConfig: DiversifyConfigSchema.partial().optional(),
    updateCheckFolder: z.string().optional(),
    imageVersionsEnabled: z.boolean().optional(),
  })
  .passthrough()

export function createDefaultTrainingConfig(): TrainingConfig {
  return TrainingConfigSchema.parse({
    name: 'CONCEPT_NAME',
    training_folder: 'CONCEPT_FOLDER/output',
    device: 'cuda:0',
    performance_log_every: 10,
    trigger_word: 'CONCEPT_NAME',
    network: { type: 'lora', linear: 32, linear_alpha: 32 },
    save: {
      dtype: 'bf16',
      save_every: 250,
      max_step_saves_to_keep: 999999,
      save_format: 'diffusers',
      push_to_hub: false
    },
    datasets: [
      {
        folder_path: 'CONCEPT_FOLDER',
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
      steps: 'CONCEPT_STEPS',
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
      name_or_path: 'F:\\AI\\Krea-2-Raw\\raw.safetensors',
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
      prompts: ['CONCEPT_PROMPT'],
      neg: '',
      seed: 42,
      walk_seed: false,
      guidance_scale: 3.5,
      sample_steps: 30
    },
    logging: {
      log_every: 1,
      use_ui_logger: false
    }
  })
}

/** Marker for Settings-page export files (not a full library backup). */
export const SETTINGS_EXPORT_FORMAT = 'lora-training-settings-export' as const

/**
 * Fields the Settings screen edits / saves — mirrors the omit list in
 * SettingsScreen.flushSave (no recent IDs, no last* tool prefs).
 */
export const EditableSettingsSubsetSchema = z.object({
  libraryRoot: z.string(),
  tools: z.object({
    joyCaption: JoyCaptionToolsSchema,
    aiToolkit: AiToolkitToolsSchema,
    photoshopExecutable: z.string()
  }),
  comfy: ComfySettingsSchema,
  queue: QueuePrefsSchema,
  defaultTrainingConfig: TrainingConfigSchema,
  updateCheckFolder: z.string(),
  imageVersionsEnabled: z.boolean().default(false)
})

export type EditableSettingsSubset = z.infer<typeof EditableSettingsSubsetSchema>

export const SettingsExportFileSchema = z.object({
  format: z.literal(SETTINGS_EXPORT_FORMAT),
  version: z.literal(1),
  exportedAt: z.string().min(1),
  settings: EditableSettingsSubsetSchema
})

export type SettingsExportFile = z.infer<typeof SettingsExportFileSchema>

/** Pick the Settings-page subset from merged AppSettings (export / save parity). */
export function pickEditableSettingsSubset(settings: AppSettings): EditableSettingsSubset {
  return EditableSettingsSubsetSchema.parse({
    libraryRoot: settings.libraryRoot,
    tools: settings.tools,
    comfy: settings.comfy,
    queue: {
      allowConcurrentCaptioning: settings.queue?.allowConcurrentCaptioning ?? false,
      continueOnFailure: settings.queue?.continueOnFailure ?? true
    },
    defaultTrainingConfig: settings.defaultTrainingConfig,
    updateCheckFolder: settings.updateCheckFolder ?? '',
    imageVersionsEnabled: settings.imageVersionsEnabled ?? false
  })
}

/** Build a versioned export document from current settings. */
export function buildSettingsExportFile(settings: AppSettings, exportedAt = new Date().toISOString()): SettingsExportFile {
  return SettingsExportFileSchema.parse({
    format: SETTINGS_EXPORT_FORMAT,
    version: 1,
    exportedAt,
    settings: pickEditableSettingsSubset(settings)
  })
}

/** Parse + validate a settings export file; throws ZodError on garbage. */
export function parseSettingsExportFile(raw: unknown): SettingsExportFile {
  return SettingsExportFileSchema.parse(raw)
}
