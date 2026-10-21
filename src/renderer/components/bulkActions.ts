import type { LucideIcon } from 'lucide-react'
import {
  BadgeCheck,
  BadgeMinus,
  BetweenHorizontalStart,
  BetweenHorizontalEnd,
  Eraser,
  FileImage,
  Replace,
  Shrink
} from 'lucide-react'

export type BulkOpId =
  | 'prefix'
  | 'suffix'
  | 'replace'
  | 'remove'
  | 'ensureTrigger'
  | 'stripTrigger'
  | 'convertToJpg'
  | 'shrinkToMax'

export const BULK_ACTIONS: Array<{
  id: BulkOpId
  label: string
  icon: LucideIcon
  /** Native tooltip — longer, action-focused help text. */
  tooltip: string
}> = [
  {
    id: 'prefix',
    label: 'Add prefix',
    icon: BetweenHorizontalStart,
    tooltip: 'Prepend text to the start of every caption in this dataset.'
  },
  {
    id: 'suffix',
    label: 'Add suffix',
    icon: BetweenHorizontalEnd,
    tooltip: 'Append text to the end of every caption in this dataset.'
  },
  {
    id: 'replace',
    label: 'Replace',
    icon: Replace,
    tooltip: 'Search and replace text in all captions of the dataset.'
  },
  {
    id: 'remove',
    label: 'Remove keyword',
    icon: Eraser,
    tooltip: 'Remove a keyword or phrase from every caption in this dataset.'
  },
  {
    id: 'ensureTrigger',
    label: 'Ensure trigger',
    icon: BadgeCheck,
    tooltip:
      'Prepend the dataset trigger (e.g. “trigger, ”) to captions that do not already include it.'
  },
  {
    id: 'stripTrigger',
    label: 'Strip trigger',
    icon: BadgeMinus,
    tooltip: 'Remove the dataset trigger word from captions where it appears.'
  },
  {
    id: 'convertToJpg',
    label: 'Convert non-PNG/JPG → JPG',
    icon: FileImage,
    tooltip: 'Convert non-PNG/JPG images in this folder to JPG (keeps PNG and JPG as-is).'
  },
  {
    id: 'shrinkToMax',
    label: 'Shrink to min 1024px (shortest edge)',
    icon: Shrink,
    tooltip:
      'Downscale images so the shortest edge is at most 1024px (larger images only; originals replaced).'
  }
]

export function bulkActionLabel(id: BulkOpId): string {
  return BULK_ACTIONS.find((a) => a.id === id)?.label ?? 'Bulk tools'
}
