import { z } from 'zod'
import { StyleIndexSchema, normalizeStyleIndex } from './validation-sets'

/**
 * Upscale/Detail tool configuration — one shared last-used snapshot in library
 * `settings.lastUpscaleConfig`. Opening Upscale on any image loads those
 * values; edits/runs update them for the next image. An empty prompt is filled
 * from the current image's caption.
 */
export const UpscaleConfigSchema = z.object({
  prompt: z.string().default(''),
  seed: z.number().default(1),
  /** Checkpoint filename; empty or `"Default"` → Settings → default validation model. */
  model: z.string().default(''),
  /** KSampler denoise strength (0..1) — injected into LT · Denoise. */
  denoise: z.number().min(0).max(1).default(0.5),
  /** 0 = realistic, 1 = anime — injected into LT · Style Index. */
  styleIndex: StyleIndexSchema,
  /** Largest-dimension target — injected into LT · Max Size. */
  maxSize: z.number().int().min(64).max(8192).default(1600)
})

export type UpscaleConfig = z.infer<typeof UpscaleConfigSchema>

export function defaultUpscaleConfig(overrides?: Partial<UpscaleConfig>): UpscaleConfig {
  return UpscaleConfigSchema.parse(overrides ?? {})
}

export function cloneUpscaleConfig(source: UpscaleConfig): UpscaleConfig {
  return UpscaleConfigSchema.parse({
    prompt: source.prompt,
    seed: source.seed,
    model: source.model,
    denoise: source.denoise,
    styleIndex: normalizeStyleIndex(source.styleIndex),
    maxSize: source.maxSize
  })
}
