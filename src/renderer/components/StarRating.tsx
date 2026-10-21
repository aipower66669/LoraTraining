import { Star } from 'lucide-react'

type Props = {
  value: number | null
  onChange: (rating: number | null) => void
  disabled?: boolean
}

/** Interactive 0–5 star rating. null = unrated (excluded from averages). */
export function StarRating(props: Props): React.JSX.Element {
  const { value, onChange, disabled } = props
  const filled = value ?? -1

  return (
    <div className="star-rating" role="group" aria-label="Image rating">
      <button
        type="button"
        className={`star-rating-zero${value === 0 ? ' active' : ''}`}
        disabled={disabled}
        title="Rate 0 stars"
        aria-pressed={value === 0}
        onClick={() => onChange(0)}
      >
        0
      </button>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = filled >= n
        return (
          <button
            key={n}
            type="button"
            className={`star-rating-star${on ? ' on' : ''}`}
            disabled={disabled}
            title={`${n} star${n === 1 ? '' : 's'}`}
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
            aria-pressed={value === n}
            onClick={() => onChange(n)}
          >
            <Star
              size={14}
              strokeWidth={2}
              fill={on ? 'currentColor' : 'none'}
              aria-hidden="true"
            />
          </button>
        )
      })}
      <button
        type="button"
        className="star-rating-clear"
        disabled={disabled || value == null}
        title="Clear rating"
        onClick={() => onChange(null)}
      >
        Clear
      </button>
    </div>
  )
}

/** Compact read-only stars for list rows (average). Fixed-size slot; blank when unrated. */
export function StarRatingReadout(props: {
  average: number | null
  count: number
}): React.JSX.Element {
  const { average, count } = props
  const has = average != null && count > 0
  if (!has) {
    return (
      <span
        className="star-rating-readout empty"
        title="Not rated"
        aria-label="Not rated"
      />
    )
  }
  const filled = Math.round(average)
  const rounded = Math.round(average * 10) / 10
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)

  return (
    <span
      className="star-rating-readout"
      title={`Average of ${count} set${count === 1 ? '' : 's'}`}
    >
      <span className="star-rating-readout-stars" aria-hidden>
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={n <= filled ? 'on' : ''}>
            <Star
              size={12}
              strokeWidth={2}
              fill={n <= filled ? 'currentColor' : 'none'}
              aria-hidden="true"
            />
          </span>
        ))}
      </span>
      <span className="mono star-rating-readout-value">{text}</span>
    </span>
  )
}
