/**
 * Caption / image readiness checks for datasets that are at least Ready.
 * Training-safe image types are JPG/JPEG/PNG only (AI Toolkit).
 */

export const TRAINING_SAFE_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png'])

export type CaptionValidationIssueKind =
  | 'bad-extension'
  | 'missing-caption'
  | 'missing-trigger'
  | 'empty-trigger'

export type CaptionValidationIssue = {
  kind: CaptionValidationIssueKind
  datasetId: string
  datasetName: string
  categoryName: string
  /** Null for dataset-level issues (e.g. empty trigger). */
  fileName: string | null
  message: string
}

export type CaptionValidationReport = {
  checkedDatasets: number
  skippedNotReady: number
  issueCount: number
  issues: CaptionValidationIssue[]
}

export function isTrainingSafeImageExt(ext: string): boolean {
  return TRAINING_SAFE_IMAGE_EXTENSIONS.has(ext.toLowerCase())
}

export function captionValidationIssueLabel(kind: CaptionValidationIssueKind): string {
  switch (kind) {
    case 'bad-extension':
      return 'Unsupported image type'
    case 'missing-caption':
      return 'Missing caption'
    case 'missing-trigger':
      return 'Missing trigger'
    case 'empty-trigger':
      return 'No trigger word'
  }
}

/** Browser-safe: same stem as convert-to-jpg (no node:path). */
function jpgNameFor(fileName: string): string {
  const i = fileName.lastIndexOf('.')
  return i > 0 ? `${fileName.slice(0, i)}.jpg` : `${fileName}.jpg`
}

/**
 * After converting unsupported images to JPG, drop those bad-extension issues and
 * rewrite other issues that still pointed at the old basename.
 */
export function patchReportAfterJpgConvert(
  report: CaptionValidationReport,
  datasetId: string,
  convertedFileNames: string[]
): CaptionValidationReport {
  if (convertedFileNames.length === 0) return report
  const rename = new Map(
    convertedFileNames.map((name) => [name.toLowerCase(), jpgNameFor(name)] as const)
  )
  const issues: CaptionValidationIssue[] = []
  for (const issue of report.issues) {
    if (issue.datasetId !== datasetId || !issue.fileName) {
      issues.push(issue)
      continue
    }
    const key = issue.fileName.toLowerCase()
    const dest = rename.get(key)
    if (!dest) {
      issues.push(issue)
      continue
    }
    if (issue.kind === 'bad-extension') continue
    issues.push({
      ...issue,
      fileName: dest,
      message: issue.message.split(issue.fileName).join(dest)
    })
  }
  return {
    ...report,
    issues,
    issueCount: issues.length
  }
}
