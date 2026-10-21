import { useLayoutEffect, useRef, useState } from 'react'

const MARGIN = 8

/** Keep a fixed context menu inside the viewport (flip up / left when near edges). */
export function clampContextMenuPosition(
  clientX: number,
  clientY: number,
  menuWidth: number,
  menuHeight: number,
  margin = MARGIN
): { x: number; y: number } {
  const maxX = Math.max(margin, window.innerWidth - menuWidth - margin)
  const maxY = Math.max(margin, window.innerHeight - menuHeight - margin)
  return {
    x: Math.min(Math.max(clientX, margin), maxX),
    y: Math.min(Math.max(clientY, margin), maxY)
  }
}

/**
 * Position a `.context-menu` at the click point, then clamp after measure so the
 * full menu stays on-screen (e.g. near the bottom taskbar).
 */
export function useClampedMenuPosition(anchor: { x: number; y: number } | null): {
  menuRef: React.RefObject<HTMLDivElement | null>
  menuStyle: { left: number; top: number } | undefined
} {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const ax = anchor?.x
  const ay = anchor?.y

  useLayoutEffect(() => {
    if (ax == null || ay == null) {
      setPos(null)
      return
    }
    const el = menuRef.current
    if (!el) {
      setPos({ x: ax, y: ay })
      return
    }
    const { width, height } = el.getBoundingClientRect()
    setPos(clampContextMenuPosition(ax, ay, width, height))
  }, [ax, ay])

  const display = pos ?? (ax != null && ay != null ? { x: ax, y: ay } : null)
  return {
    menuRef,
    menuStyle: display ? { left: display.x, top: display.y } : undefined
  }
}
