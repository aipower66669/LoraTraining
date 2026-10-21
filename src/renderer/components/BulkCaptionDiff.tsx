import {
  diffTokens,
  partsForAfter,
  partsForBefore,
  type DiffPart
} from '@shared/text-diff'

function DiffText(props: { parts: DiffPart[]; emptyLabel: string }): React.JSX.Element {
  if (props.parts.length === 0) {
    return <span className="bulk-diff-empty">{props.emptyLabel}</span>
  }
  return (
    <>
      {props.parts.map((p, i) => {
        if (p.type === 'equal') {
          return (
            <span key={i} className="bulk-diff-eq">
              {p.text}
            </span>
          )
        }
        if (p.type === 'remove') {
          return (
            <span key={i} className="bulk-diff-del">
              {p.text}
            </span>
          )
        }
        return (
          <span key={i} className="bulk-diff-add">
            {p.text}
          </span>
        )
      })}
    </>
  )
}

export function BulkCaptionDiff(props: {
  before: string
  after: string
}): React.JSX.Element {
  const parts = diffTokens(props.before, props.after)
  const beforeParts = partsForBefore(parts)
  const afterParts = partsForAfter(parts)
  return (
    <div className="bulk-diff">
      <div className="bulk-diff-row">
        <span className="bulk-diff-label">Before</span>
        <div className="bulk-diff-text mono">
          <DiffText parts={beforeParts} emptyLabel="(empty)" />
        </div>
      </div>
      <div className="bulk-diff-row">
        <span className="bulk-diff-label">After</span>
        <div className="bulk-diff-text mono">
          <DiffText parts={afterParts} emptyLabel="(empty)" />
        </div>
      </div>
    </div>
  )
}
