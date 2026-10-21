import { describe, expect, it } from 'vitest'
import {
  patchReportAfterJpgConvert,
  type CaptionValidationReport
} from '@shared/caption-validation'

function report(issues: CaptionValidationReport['issues']): CaptionValidationReport {
  return {
    checkedDatasets: 1,
    skippedNotReady: 0,
    issueCount: issues.length,
    issues
  }
}

describe('patchReportAfterJpgConvert', () => {
  it('drops bad-extension issues and renames sibling issues', () => {
    const before = report([
      {
        kind: 'bad-extension',
        datasetId: 'ds1',
        datasetName: 'A',
        categoryName: 'Cat',
        fileName: 'x.webp',
        message: 'x.webp — use .jpg or .png (not .webp)'
      },
      {
        kind: 'missing-caption',
        datasetId: 'ds1',
        datasetName: 'A',
        categoryName: 'Cat',
        fileName: 'x.webp',
        message: 'x.webp — missing caption'
      },
      {
        kind: 'missing-caption',
        datasetId: 'ds1',
        datasetName: 'A',
        categoryName: 'Cat',
        fileName: 'y.png',
        message: 'y.png — missing caption'
      }
    ])
    const after = patchReportAfterJpgConvert(before, 'ds1', ['x.webp'])
    expect(after.issueCount).toBe(2)
    expect(after.issues.map((i) => i.fileName)).toEqual(['x.jpg', 'y.png'])
    expect(after.issues[0]?.message).toBe('x.jpg — missing caption')
  })
})
