import { useRef, useState, type ReactNode } from 'react'
import { ConfirmDialog } from './ConfirmDialog'

export function useConfirm(): {
  ask: (opts: {
    title: string
    message: string
    confirmLabel?: string
    danger?: boolean
  }) => Promise<boolean>
  dialog: ReactNode
} {
  const [state, setState] = useState<{
    title: string
    message: string
    confirmLabel?: string
    danger?: boolean
    resolve: (v: boolean) => void
  } | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  return {
    ask: (opts) =>
      new Promise((resolve) => {
        setState({ ...opts, resolve })
      }),
    dialog: (
      <ConfirmDialog
        open={Boolean(state)}
        title={state?.title ?? ''}
        confirmLabel={state?.confirmLabel}
        danger={state?.danger}
        autoFocusConfirm
        enterConfirms
        onCancel={() => {
          stateRef.current?.resolve(false)
          setState(null)
        }}
        onConfirm={() => {
          stateRef.current?.resolve(true)
          setState(null)
        }}
      >
        <p>{state?.message}</p>
      </ConfirmDialog>
    )
  }
}
