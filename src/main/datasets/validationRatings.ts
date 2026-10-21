import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  averageCheckpointRating,
  emptyValidationRatings,
  getSetStemRating,
  ValidationRatingsFileSchema,
  type ValidationRatingsFile
} from '@shared/validation-ratings'
import { appError } from '@shared/errors'
import { atomicWriteJson } from '../security/atomic-write'

function ratingsPath(datasetFolder: string): string {
  return join(datasetFolder.replace(/[/\\]+$/, ''), 'output', 'validation-ratings.json')
}

export async function loadValidationRatings(datasetFolder: string): Promise<ValidationRatingsFile> {
  const path = ratingsPath(datasetFolder)
  try {
    const raw = await readFile(path, 'utf8')
    return ValidationRatingsFileSchema.parse(JSON.parse(raw))
  } catch {
    return emptyValidationRatings()
  }
}

async function saveValidationRatings(
  datasetFolder: string,
  file: ValidationRatingsFile
): Promise<void> {
  await atomicWriteJson(ratingsPath(datasetFolder), ValidationRatingsFileSchema.parse(file))
}

export function ratingSummaryForStem(
  file: ValidationRatingsFile,
  stem: string
): { rating?: undefined; average: number | null; count: number } {
  const { average, count } = averageCheckpointRating(file, stem)
  return { average, count }
}

/**
 * Set or clear (null) a 0–5 rating for one set preview of a checkpoint stem.
 */
export async function setValidationRatingForFolder(opts: {
  datasetFolder: string
  setLabel: string
  stem: string
  rating: number | null
}): Promise<{ rating: number | null; average: number | null; count: number }> {
  const { datasetFolder, setLabel, stem, rating } = opts
  if (!setLabel.trim() || !stem.trim()) {
    throw appError('validation', 'setLabel and stem are required')
  }
  if (rating != null && (!Number.isInteger(rating) || rating < 0 || rating > 5)) {
    throw appError('validation', 'Rating must be an integer 0–5, or null to clear')
  }

  const file = await loadValidationRatings(datasetFolder)
  const label = setLabel.trim()
  const key = stem.trim()

  if (rating == null) {
    const bucket = file.ratings[label]
    if (bucket) {
      delete bucket[key]
      if (Object.keys(bucket).length === 0) delete file.ratings[label]
    }
  } else {
    if (!file.ratings[label]) file.ratings[label] = {}
    file.ratings[label]![key] = rating
  }

  await saveValidationRatings(datasetFolder, file)
  const { average, count } = averageCheckpointRating(file, key)
  return { rating, average, count }
}

export async function getValidationRatingForFolder(opts: {
  datasetFolder: string
  setLabel: string
  stem: string
}): Promise<{ rating: number | null; average: number | null; count: number }> {
  const file = await loadValidationRatings(opts.datasetFolder)
  const { average, count } = averageCheckpointRating(file, opts.stem)
  return {
    rating: getSetStemRating(file, opts.setLabel, opts.stem),
    average,
    count
  }
}
