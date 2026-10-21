import type { CSSProperties } from 'react'
import { PromptEditor } from './PromptEditor'
import { useWildcardKeys } from './useWildcardKeys'

type Props = {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  /** Approximate textarea rows → min-height. */
  rows?: number
  placeholder?: string
  disabled?: boolean
  className?: string
}

/**
 * Shared prompt editing field (Validate / Stress / Upscale): syntax highlighting
 * and `__wildcard__` autocomplete from Settings → Wildcards folder.
 */
export function PromptField(props: Props): React.JSX.Element {
  const keys = useWildcardKeys()
  const rows = props.rows ?? 2
  const style = {
    ['--prompt-field-rows' as string]: String(rows)
  } as CSSProperties

  return (
    <div
      className={`prompt-field${props.disabled ? ' prompt-field-disabled' : ''}${
        props.className ? ` ${props.className}` : ''
      }`}
      style={style}
    >
      <PromptEditor
        value={props.value}
        onChange={props.onChange}
        onBlur={props.onBlur}
        readOnly={props.disabled}
        placeholder={props.placeholder}
        wildcardKeys={keys}
      />
    </div>
  )
}
