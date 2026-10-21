import type { ValidationProgress } from '@shared/comfy'

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string
          allowpopups?: string | boolean
          partition?: string
          webpreferences?: string
        },
        HTMLElement
      >
    }
  }
}

export type { ValidationProgress }
