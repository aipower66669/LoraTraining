import { z } from 'zod'

/**
 * Category as used in-app. `folder` is relative to libraryRoot (may be nested,
 * e.g. `Group/Category`); `folderPath` is absolute (join(libraryRoot, folder)).
 */
export const CategoryRecordSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  sortOrder: z.number().int().default(0),
  /**
   * Relative path under libraryRoot (forward slashes; may include subfolders).
   * Empty only during legacy parse before migration.
   */
  folder: z.string().default(''),
  /**
   * Absolute path on disk — filled when loading from libraryRoot.
   * Not persisted in categories.json (derived).
   */
  folderPath: z.string().default(''),
  createdAt: z.string(),
  updatedAt: z.string()
})

export type CategoryRecord = z.infer<typeof CategoryRecordSchema>

/** On-disk categories.json at library root. */
export const CategoriesFileSchema = z.object({
  version: z.literal(1).default(1),
  categories: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().min(1),
        sortOrder: z.number().int().default(0),
        folder: z.string().min(1),
        createdAt: z.string(),
        updatedAt: z.string()
      })
    )
    .default([])
})

export type CategoriesFile = z.infer<typeof CategoriesFileSchema>

/** Per-category sidecar category.json */
export const CategorySidecarSchema = z.object({
  version: z.literal(1).default(1),
  id: z.string(),
  name: z.string().min(1),
  sortOrder: z.number().int().default(0),
  folder: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string()
})

/** Legacy id once used for a built-in category; no longer special-cased. */
export const DEFAULT_CATEGORY_ID = 'general'

/** @deprecated No built-in default category. */
export const DEFAULT_CATEGORY_NAME = 'General'

/** Top-level image types that qualify a subfolder as a discoverable dataset. */
export const DATASET_DISCOVERY_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png'])
