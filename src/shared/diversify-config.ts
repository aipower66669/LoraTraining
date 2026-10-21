import { z } from 'zod'

export const DiversifyModeSchema = z.enum(['context', 'expression'])
export type DiversifyMode = z.infer<typeof DiversifyModeSchema>

/**
 * Last-used Diversify field values (per mode) in library settings.
 * Context: prompt is remembered as typed (never caption-filled); seed ≤0 = random.
 * Expression: only `count` is used in the UI; seed is always randomized per run and injected via LT · Seed.
 */
export const DiversifyConfigSchema = z.object({
  prompt: z.string().default(''),
  /** ≤0 → random base seed at run time (batch offsets from that). */
  seed: z.number().default(0),
  /** How many new siblings to generate per source image (≥1). */
  count: z.number().int().min(1).max(64).default(1)
})

export type DiversifyConfig = z.infer<typeof DiversifyConfigSchema>

export function defaultDiversifyConfig(overrides?: Partial<DiversifyConfig>): DiversifyConfig {
  return DiversifyConfigSchema.parse(overrides ?? {})
}

export function cloneDiversifyConfig(source: DiversifyConfig): DiversifyConfig {
  return DiversifyConfigSchema.parse({
    prompt: source.prompt,
    seed: source.seed,
    count: source.count
  })
}
