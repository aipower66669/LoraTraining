import { describe, expect, it } from 'vitest'
import { jobBreadcrumbLabel } from '@shared/dataset-jobs'

describe('jobBreadcrumbLabel', () => {
  it('joins category and dataset with a backslash breadcrumb', () => {
    expect(jobBreadcrumbLabel('General', 'Adult')).toBe('General \\ Adult')
  })

  it('falls back to Uncategorized / Untitled', () => {
    expect(jobBreadcrumbLabel('', '')).toBe('Uncategorized \\ Untitled')
    expect(jobBreadcrumbLabel(null, 'Solo')).toBe('Uncategorized \\ Solo')
  })
})
