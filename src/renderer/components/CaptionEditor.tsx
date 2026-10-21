import { useEffect, useMemo, useRef, useState } from 'react'
import { unwrap, useAppStore } from '../store'

const MULTIPLE_CAPTIONS_PLACEHOLDER = '<multiple captions selected>'

export function CaptionEditor(props: {
  datasetId: string
  /** Selected image file names (grid order). Empty = nothing selected. */
  fileNames: string[]
  fill?: boolean
  /** Bump to force re-fetch (e.g. after bulk caption transforms). */
  reloadKey?: number
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [mixed, setMixed] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirty = useRef(false)
  const textRef = useRef('')
  const mixedRef = useRef(false)
  const loadGen = useRef(0)
  const fileNamesRef = useRef(props.fileNames)
  fileNamesRef.current = props.fileNames
  const markImageCaptioned = useAppStore((s) => s.markImageCaptioned)

  const fileNamesKey = useMemo(() => props.fileNames.join('\0'), [props.fileNames])

  useEffect(() => {
    textRef.current = text
  }, [text])

  useEffect(() => {
    mixedRef.current = mixed
  }, [mixed])

  useEffect(() => {
    const fileNames = props.fileNames
    if (fileNames.length === 0) {
      setText('')
      setMixed(false)
      setLoading(false)
      dirty.current = false
      return
    }
    const gen = ++loadGen.current
    const datasetId = props.datasetId
    let cancelled = false
    setLoading(true)
    setText('')
    setMixed(false)
    dirty.current = false

    void (async () => {
      try {
        const texts: string[] = []
        for (const fileName of fileNames) {
          const r = unwrap(
            await window.loraTraining.captions.get(datasetId, fileName)
          ) as { text: string | null }
          if (cancelled || gen !== loadGen.current) return
          texts.push(r.text ?? '')
        }
        if (cancelled || gen !== loadGen.current) return
        const first = texts[0] ?? ''
        const allSame = texts.every((t) => t === first)
        setMixed(!allSame)
        setText(allSame ? first : '')
        dirty.current = false
      } catch {
        if (cancelled || gen !== loadGen.current) return
        setText('')
        setMixed(false)
      } finally {
        if (!cancelled && gen === loadGen.current) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      // Flush pending debounce so navigating away doesn't drop edits.
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
        if (dirty.current && !mixedRef.current) {
          const pending = textRef.current
          const targets = [...fileNamesRef.current]
          dirty.current = false
          void (async () => {
            for (const fileName of targets) {
              await window.loraTraining.captions.set(datasetId, fileName, pending)
              markImageCaptioned(fileName)
            }
          })()
        }
      }
    }
  }, [props.datasetId, fileNamesKey, props.reloadKey, markImageCaptioned])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (props.fileNames.length > 0 && !mixed && dirty.current) {
          void flush(text)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function flush(next: string): Promise<void> {
    const targets = fileNamesRef.current
    if (targets.length === 0 || mixed) return
    for (const fileName of targets) {
      await window.loraTraining.captions.set(props.datasetId, fileName, next)
      markImageCaptioned(fileName)
    }
    setSaved(true)
    dirty.current = false
    window.setTimeout(() => setSaved(false), 1200)
  }

  function onChange(next: string): void {
    if (mixed) return
    setText(next)
    dirty.current = true
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void flush(next)
    }, 400)
  }

  if (props.fileNames.length === 0) {
    return (
      <div className={`caption-editor${props.fill ? ' caption-editor-fill' : ''}`}>
        <div className="empty">Select an image to edit its caption.</div>
      </div>
    )
  }

  const displayText = mixed ? MULTIPLE_CAPTIONS_PLACEHOLDER : text
  const words = !mixed && text.trim() ? text.trim().split(/\s+/).length : 0

  return (
    <div className={`caption-editor${props.fill ? ' caption-editor-fill' : ''}`}>
      {loading ? (
        <p className="hint">Loading…</p>
      ) : (
        <>
          <textarea
            className="caption-textarea"
            value={displayText}
            disabled={mixed}
            readOnly={mixed}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Caption text"
            aria-label={
              mixed
                ? 'Multiple different captions selected'
                : props.fileNames.length > 1
                  ? `Caption for ${props.fileNames.length} images`
                  : 'Caption'
            }
          />
          <div className="caption-meta">
            <div className="caption-count hint">
              {mixed
                ? `${props.fileNames.length} images · captions differ`
                : props.fileNames.length > 1
                  ? `${props.fileNames.length} images · ${words} word${words === 1 ? '' : 's'} · ${text.length} chars`
                  : `${words} word${words === 1 ? '' : 's'} · ${text.length} chars`}
            </div>
            <span className={`saved${saved ? '' : ' is-hidden'}`} aria-live="polite">
              Saved
            </span>
          </div>
        </>
      )}
    </div>
  )
}
