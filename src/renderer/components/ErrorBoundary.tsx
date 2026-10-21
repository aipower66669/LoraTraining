import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Shown in the fallback UI so the user knows what crashed (e.g. a screen name). */
  label?: string
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Catches render/lifecycle errors thrown by its subtree so a bug in one screen
 * shows a recoverable message instead of a blank white window. Does not catch
 * errors from event handlers or async code — those should use `useAppStore`'s
 * `setError` instead.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ''}]`, error, info.componentStack)
  }

  private reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="error-boundary" role="alert">
        <h2>Something went wrong{this.props.label ? ` in ${this.props.label}` : ''}</h2>
        <p className="error-boundary-message">{error.message || 'An unexpected error occurred.'}</p>
        <div className="error-boundary-actions">
          <button type="button" onClick={this.reset}>
            Try again
          </button>
          <button type="button" onClick={() => window.location.reload()}>
            Reload app
          </button>
        </div>
      </div>
    )
  }
}
