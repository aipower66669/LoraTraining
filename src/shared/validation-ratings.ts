import { z } from 'zod'

/** Per-image rating: 0–5 stars, or omit/null = unrated (excluded from averages). */
export const ValidationRatingValueSchema = z.number().int().min(0).max(5)

/**
 * `{dataset}/output/validation-ratings.json`
 * ratings[setLabel][stem] = 0..5
 */
export const ValidationRatingsFileSchema = z.object({
  version: z.literal(1).default(1),
  ratings: z.record(z.string(), z.record(z.string(), ValidationRatingValueSchema)).default({})
})

export type ValidationRatingsFile = z.infer<typeof ValidationRatingsFileSchema>

export function emptyValidationRatings(): ValidationRatingsFile {
  return ValidationRatingsFileSchema.parse({ version: 1, ratings: {} })
}

/** Mean of rated sets for one checkpoint stem; null if none rated. */
export function averageCheckpointRating(
  file: ValidationRatingsFile,
  stem: string
): { average: number | null; count: number } {
  const values: number[] = []
  for (const byStem of Object.values(file.ratings)) {
    const v = byStem[stem]
    if (typeof v === 'number' && v >= 0 && v <= 5) values.push(v)
  }
  if (values.length === 0) return { average: null, count: 0 }
  const sum = values.reduce((a, b) => a + b, 0)
  return { average: sum / values.length, count: values.length }
}

export function getSetStemRating(
  file: ValidationRatingsFile,
  setLabel: string,
  stem: string
): number | null {
  const v = file.ratings[setLabel]?.[stem]
  return typeof v === 'number' ? v : null
}

export function formatAverageRating(average: number | null, count: number): string {
  if (average == null || count <= 0) return '—'
  const rounded = Math.round(average * 10) / 10
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return `${text}★`
}
