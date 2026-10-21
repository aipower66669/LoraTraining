import { useEffect, useId, useRef, type ReactNode } from 'react'
import { isTypingTarget } from '@shared/keyboard'

export function ConfirmDialog(props: {
  open: boolean
  title: string
  children: ReactNode
  /** Extra class on the `.modal` panel (layout / overflow overrides). */
  className?: string
  confirmLabel?: string
  danger?: boolean
  /** Disable the primary confirm button. */
  confirmDisabled?: boolean
  /** Tighter padding/gaps for short forms. */
  compact?: boolean
  /** Ignore Escape / backdrop dismiss (e.g. while a native folder picker is open). */
  dismissDisabled?: boolean
  /**
   * Block backdrop / chrome dismiss only — Escape still cancels
   * (e.g. search/replace, where a mis-click is easy but Esc is intentional).
   */
  preventBackdropDismiss?: boolean
  /**
   * Enter confirms (Apply / OK). Works from single-line inputs; skipped in
   * textareas unless Ctrl/Cmd+Enter (so newlines still work).
   */
  enterConfirms?: boolean
  /** When true, focus the confirm button on open (Enter confirms). */
  autoFocusConfirm?: boolean
  /** Hide Cancel — single confirm/OK button only. */
  hideCancel?: boolean
  /**
   * Dismiss on backdrop or click on non-interactive dialog chrome
   * (saves a trip to the OK button).
   */
  dismissOnAnywhere?: boolean
  /** Optional action pinned to the left (e.g. “Fix missing”). */
  leftActionLabel?: string
  leftActionTitle?: string
  onLeftAction?: () => void
  onConfirm: () => void
  onCancel: () => void
}): ReactNode {
  const titleId = useId()
  /** Only dismiss when press + release both land on the backdrop (not drag-out from a field). */
  const backdropArmed = useRef(false)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const dismissDisabled = props.dismissDisabled === true
  const preventBackdropDismiss =
    dismissDisabled || props.preventBackdropDismiss === true
  const hideCancel = props.hideCancel === true
  const dismissOnAnywhere = props.dismissOnAnywhere === true
  const enterConfirms = props.enterConfirms === true

  useEffect(() => {
    if (!props.open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (dismissDisabled) return
        e.preventDefault()
        props.onCancel()
        return
      }
      if (e.key !== 'Enter') return
      const shouldConfirm =
        enterConfirms || (hideCancel && dismissOnAnywhere)
      if (!shouldConfirm) return
      if (props.confirmDisabled === true) return
      if (isTypingTarget(e.target)) {
        const el = e.target
        const isTextarea =
          el instanceof HTMLTextAreaElement ||
          (el instanceof HTMLElement && el.isContentEditable)
        // Allow Enter from inputs; textareas need Ctrl/Cmd+Enter.
        if (isTextarea && !(e.ctrlKey || e.metaKey)) return
        if (
          el instanceof HTMLElement &&
          el.tagName === 'SELECT' &&
          !(e.ctrlKey || e.metaKey)
        ) {
          return
        }
      }
      e.preventDefault()
      if (hideCancel) props.onCancel()
      else props.onConfirm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    props.open,
    props.onCancel,
    props.onConfirm,
    props.confirmDisabled,
    enterConfirms,
    dismissDisabled,
    hideCancel,
    dismissOnAnywhere
  ])

  /**
   * Focus confirm only on the open transition (if requested then). Never when
   * autoFocusConfirm flips later, and never if a text field already has focus.
   */
  useEffect(() => {
    if (!props.open || !props.autoFocusConfirm) return
    const t = window.setTimeout(() => {
      if (isTypingTarget(document.activeElement)) return
      confirmRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(t)
    // Intentionally only when `open` becomes true — not when autoFocusConfirm changes.
     
  }, [props.open])

  useEffect(() => {
    if (!props.open) {
      backdropArmed.current = false
      return
    }
    const disarm = (): void => {
      backdropArmed.current = false
    }
    // Release outside the app/window must not leave a stale arm that closes later.
    window.addEventListener('pointerup', disarm)
    window.addEventListener('pointercancel', disarm)
    return () => {
      window.removeEventListener('pointerup', disarm)
      window.removeEventListener('pointercancel', disarm)
      backdropArmed.current = false
    }
  }, [props.open])

  function dismiss(): void {
    if (!preventBackdropDismiss) props.onCancel()
  }

  if (!props.open) return null
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onPointerDown={(e) => {
        backdropArmed.current = !preventBackdropDismiss && e.target === e.currentTarget
      }}
      onPointerUp={(e) => {
        if (backdropArmed.current && e.target === e.currentTarget) {
          backdropArmed.current = false
          dismiss()
        }
      }}
      onClick={(e) => {
        // Swallow clicks so drag-select / release-outside never dismisses via click.
        e.stopPropagation()
      }}
    >
      <div
        className={`modal${props.compact ? ' modal-compact' : ''}${
          props.className ? ` ${props.className}` : ''
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onPointerDown={(e) => {
          if (!dismissOnAnywhere) e.stopPropagation()
        }}
        onClick={(e) => {
          e.stopPropagation()
          if (!dismissOnAnywhere || preventBackdropDismiss) return
          const el = e.target
          if (!(el instanceof Element)) return
          // Keep typing / choosing options; OK has its own handler.
          if (el.closest('input, textarea, select, button, a, label')) return
          dismiss()
        }}
      >
        <h3 id={titleId}>{props.title}</h3>
        <div className="modal-body">{props.children}</div>
        <div className="modal-actions">
          {props.leftActionLabel && props.onLeftAction ? (
            <button
              type="button"
              className="modal-actions-left"
              title={props.leftActionTitle}
              onClick={props.onLeftAction}
            >
              {props.leftActionLabel}
            </button>
          ) : null}
          {!hideCancel && (
            <button type="button" onClick={props.onCancel}>
              Cancel
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            className={props.danger ? 'danger' : 'primary'}
            disabled={props.confirmDisabled === true}
            onClick={hideCancel ? props.onCancel : props.onConfirm}
          >
            {props.confirmLabel ?? (hideCancel ? 'OK' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
