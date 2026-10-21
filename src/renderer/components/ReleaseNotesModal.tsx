import { useEffect, useState } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { X } from 'lucide-react'
import { resolveReleaseNotesHref, type AppReleaseNotes } from '@shared/github-update'
import { unwrap } from '../store'

function releaseNotesHtml(markdown: string): string {
  const raw = marked.parse(markdown, { async: false, gfm: true })
  const html = typeof raw === 'string' ? raw : ''
  return DOMPurify.sanitize(html)
}

export function ReleaseNotesModal(props: { version: string; onClose: () => void }): React.JSX.Element {
  const { version, onClose } = props
  const [notes, setNotes] = useState<AppReleaseNotes | null>(null)
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancel = false
    setNotes(null)
    setHtml(null)
    setError(null)
    void (async () => {
      try {
        const result = unwrap(
          await window.loraTraining.system.getReleaseNotes(version)
        ) as AppReleaseNotes
        if (cancel) return
        setNotes(result)
        setHtml(releaseNotesHtml(result.markdown))
      } catch (err) {
        if (cancel) return
        setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancel = true
    }
  }, [version])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const title = notes?.title?.trim() || `What's new in ${version}`

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="modal release-notes-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="release-notes-head">
          <h3>{title}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <div className="modal-body release-notes-body">
          {error ? (
            <p className="error-banner">{error}</p>
          ) : html === null ? (
            <p className="hint">Loading release notes…</p>
          ) : (
            <div
              className="release-notes-md"
              onClick={(event) => {
                const anchor = (event.target as HTMLElement | null)?.closest('a')
                if (!anchor) return
                const href = anchor.getAttribute('href')
                const url = href ? resolveReleaseNotesHref(href, notes?.tag ?? null) : null
                if (!url) return
                event.preventDefault()
                window.open(url)
              }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>
        <div className="modal-actions">
          {notes?.htmlUrl ? (
            <button
              type="button"
              onClick={() => {
                const url = resolveReleaseNotesHref(notes.htmlUrl ?? '', notes.tag)
                if (url) window.open(url)
              }}
            >
              Open on GitHub
            </button>
          ) : (
            <span />
          )}
          <button type="button" className="primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
