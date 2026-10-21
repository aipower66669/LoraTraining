/** True when the event target is (or is inside) a field that should keep keyboard input. */
export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (target == null || typeof HTMLElement === 'undefined') return false
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], .context-menu'
    )
  )
}

/** Next index with wrap-around (`delta` typically ±1). Empty list → -1. */
export function cycleIndex(length: number, current: number, delta: number): number {
  if (length <= 0) return -1
  if (current < 0 || current >= length) return delta >= 0 ? 0 : length - 1
  return (current + delta + length) % length
}
