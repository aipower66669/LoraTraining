import { useEffect, useMemo, useState } from 'react'
import {
  captionValidationIssueLabel,
  type CaptionValidationIssue,
  type CaptionValidationIssueKind,
  type CaptionValidationReport
} from '@shared/caption-validation'
import { ConfirmDialog } from './ConfirmDialog'

const KIND_ORDER: CaptionValidationIssueKind[] = [
  'missing-caption',
  'missing-trigger',
  'empty-trigger',
  'bad-extension'
]

function issuePrimaryLine(issue: CaptionValidationIssue): string {
  if (issue.fileName) return issue.fileName
  return issue.datasetName
}

function issueSecondaryLine(issue: CaptionValidationIssue): string {
  const loc = `${issue.categoryName} \\ ${issue.datasetName}`
  if (!issue.fileName) return loc
  if (issue.kind === 'bad-extension') {
    const hint = issue.message.includes('—')
      ? issue.message.slice(issue.message.indexOf('—') + 1).trim()
      : null
    return hint ? `${loc} · ${hint}` : loc
  }
  if (issue.kind === 'missing-trigger') {
    const m = /trigger “([^”]+)”/.exec(issue.message)
    return m ? `${loc} · trigger “${m[1]}”` : loc
  }
  return loc
}

export function CaptionValidationResults(props: {
  open: boolean
  busy: boolean
  fixing: boolean
  report: CaptionValidationReport | null
  onClose: () => void
  onValidate: () => void
  onOpenIssue: (issue: CaptionValidationIssue) => void
  /** Convert unsupported image(s) to JPG in place. */
  onFixBadExtensions: (issues: CaptionValidationIssue[]) => void
}): React.JSX.Element | null {
  const tabs = useMemo(() => {
    const issues = props.report?.issues ?? []
    return KIND_ORDER.map((kind) => ({
      kind,
      label: captionValidationIssueLabel(kind),
      issues: issues.filter((i) => i.kind === kind)
    })).filter((t) => t.issues.length > 0)
  }, [props.report])

  const [activeKind, setActiveKind] = useState<CaptionValidationIssueKind | null>(null)

  useEffect(() => {
    if (!props.open) {
      setActiveKind(null)
      return
    }
    setActiveKind((prev) => {
      if (prev && tabs.some((t) => t.kind === prev)) return prev
      return tabs[0]?.kind ?? null
    })
  }, [props.open, tabs])

  const active = tabs.find((t) => t.kind === activeKind) ?? tabs[0] ?? null
  const actionsLocked = props.busy || props.fixing

  if (!props.open) return null

  const hasReport = props.report != null
  const issueCount = props.report?.issueCount ?? 0

  let summary: string
  if (props.busy && !hasReport) {
    summary = 'Checking Ready and higher datasets…'
  } else if (!hasReport) {
    summary = 'No validation run yet. Click Validate to check Ready+ datasets.'
  } else if (issueCount === 0) {
    summary = props.busy
      ? 'Re-checking…'
      : `No issues in ${props.report!.checkedDatasets} Ready+ dataset${
          props.report!.checkedDatasets === 1 ? '' : 's'
        }.`
  } else if (props.fixing) {
    summary = 'Converting to JPG…'
  } else {
    summary = props.busy
      ? 'Re-checking… (showing previous results)'
      : `${issueCount} issue${issueCount === 1 ? '' : 's'} in ${
          props.report!.checkedDatasets
        } Ready+ dataset${props.report!.checkedDatasets === 1 ? '' : 's'}. Click a row to open it.`
  }

  return (
    <ConfirmDialog
      open={props.open}
      className="caption-validation-dialog"
      title="Caption validation"
      confirmLabel="Close"
      hideCancel
      dismissDisabled={actionsLocked}
      leftActionLabel={props.busy ? 'Validating…' : 'Validate'}
      leftActionTitle="Check Ready and higher datasets"
      onLeftAction={actionsLocked ? () => undefined : props.onValidate}
      onConfirm={props.onClose}
      onCancel={props.onClose}
    >
      <p className="hint caption-validation-summary">{summary}</p>
      {issueCount > 0 && active ? (
        <>
          <div className="caption-validation-tabs-row">
            <div className="caption-validation-tabs" role="tablist" aria-label="Issue type">
              {tabs.map((tab) => {
                const selected = tab.kind === active.kind
                return (
                  <button
                    key={tab.kind}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    className={`caption-validation-tab${selected ? ' active' : ''}`}
                    onClick={() => setActiveKind(tab.kind)}
                  >
                    {tab.label}
                    <span className="caption-validation-tab-count">{tab.issues.length}</span>
                  </button>
                )
              })}
            </div>
            {active.kind === 'bad-extension' ? (
              <button
                type="button"
                className="caption-validation-fix-all"
                disabled={actionsLocked}
                title="Convert all listed images to JPG"
                onClick={() => props.onFixBadExtensions(active.issues)}
              >
                {props.fixing ? 'Fixing…' : 'Fix all'}
              </button>
            ) : null}
          </div>
          <ul className="caption-validation-list" role="tabpanel">
            {active.issues.map((issue, i) => (
              <li
                key={`${issue.datasetId}:${issue.fileName ?? ''}:${i}`}
                className="caption-validation-row"
              >
                <button
                  type="button"
                  className="caption-validation-issue"
                  onClick={() => props.onOpenIssue(issue)}
                  title="Open this dataset / image"
                >
                  <span className="caption-validation-primary">{issuePrimaryLine(issue)}</span>
                  <span className="caption-validation-secondary">
                    {issueSecondaryLine(issue)}
                  </span>
                </button>
                {issue.kind === 'bad-extension' && issue.fileName ? (
                  <button
                    type="button"
                    className="caption-validation-fix"
                    disabled={actionsLocked}
                    title="Convert this image to JPG"
                    onClick={() => props.onFixBadExtensions([issue])}
                  >
                    Fix
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </ConfirmDialog>
  )
}
