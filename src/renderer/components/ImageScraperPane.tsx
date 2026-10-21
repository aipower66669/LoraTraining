import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, RefreshCw, X } from 'lucide-react'
import {
  IMAGE_SCRAPER_SOURCE_INFO,
  parseImageScraperSource,
  type ImageScraperSource
} from '@shared/image-scraper'
import type { AppSettings } from '@shared/schemas/settings'
import { unwrap, useAppStore } from '../store'

type ScrapePayload = { url?: string; pageUrl?: string; trustAsImage?: boolean }

/**
 * Embedded browser for one-click image import into the selected dataset.
 * Sources: Pinterest and Google Images (remembered in library settings).
 */
export function ImageScraperPane(props: {
  datasetId: string | null
  datasetName: string | null
  onClose: () => void
}): React.JSX.Element {
  const webviewRef = useRef<Electron.WebviewTag | null>(null)
  const datasetIdRef = useRef(props.datasetId)
  const datasetNameRef = useRef(props.datasetName)
  datasetIdRef.current = props.datasetId
  datasetNameRef.current = props.datasetName

  const settings = useAppStore((s) => s.settings)
  const [source, setSource] = useState<ImageScraperSource>(() =>
    parseImageScraperSource(settings?.lastImageScraperSource)
  )
  const sourceInfo = IMAGE_SCRAPER_SOURCE_INFO[source]

  const [preloadPath, setPreloadPath] = useState<string | null>(null)
  const [busyUrl, setBusyUrl] = useState<string | null>(null)
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  const setStatus = useAppStore((s) => s.setStatus)
  const setError = useAppStore((s) => s.setError)
  const loadDataset = useAppStore((s) => s.loadDataset)
  const inflight = useRef(new Set<string>())

  // Keep local source in sync if settings load after mount.
  useEffect(() => {
    if (!settings) return
    setSource(parseImageScraperSource(settings.lastImageScraperSource))
  }, [settings?.lastImageScraperSource])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { path } = unwrap(
          await window.loraTraining.system.imageScraperGuestPreloadUrl()
        ) as { path: string; url: string }
        if (!cancelled) setPreloadPath(path)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [setError])

  useEffect(() => {
    const el = webviewRef.current
    if (!el || !preloadPath) return

    const downloadUrl = async (
      url: string,
      opts?: { referrer?: string; trustAsImage?: boolean }
    ): Promise<void> => {
      const datasetId = datasetIdRef.current
      if (!datasetId) {
        setError('Select a dataset in the library first — downloads go there.')
        return
      }
      if (inflight.current.has(url)) return
      inflight.current.add(url)
      setBusyUrl(url)
      try {
        const result = unwrap(
          await window.loraTraining.datasets.importFromUrl(datasetId, url, opts)
        ) as { fileName: string; converted: boolean }
        setLastSaved(result.fileName)
        setStatus(
          `Saved ${result.fileName}${result.converted ? ' (→ JPG)' : ''} → ${
            datasetNameRef.current ?? 'dataset'
          }`
        )
        if (useAppStore.getState().selectedDatasetId === datasetId) {
          await loadDataset(datasetId, { preserveCaptionFlags: true })
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        inflight.current.delete(url)
        setBusyUrl((cur) => (cur === url ? null : cur))
      }
    }

    const onIpc = (event: Electron.IpcMessageEvent): void => {
      if (event.channel !== 'scrape-image') return
      const payload = (event.args[0] ?? {}) as ScrapePayload
      const url = typeof payload.url === 'string' ? payload.url : ''
      if (!url) return
      void downloadUrl(url, {
        referrer: typeof payload.pageUrl === 'string' ? payload.pageUrl : undefined,
        trustAsImage: payload.trustAsImage === true
      })
    }

    el.addEventListener('ipc-message', onIpc)
    return () => {
      el.removeEventListener('ipc-message', onIpc)
    }
  }, [preloadPath, source, loadDataset, setError, setStatus])

  async function onSourceChange(next: ImageScraperSource): Promise<void> {
    setSource(next)
    setLastSaved(null)
    try {
      const saved = unwrap(
        await window.loraTraining.settings.set({ lastImageScraperSource: next })
      ) as AppSettings
      useAppStore.setState({ settings: saved })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function goBack(): void {
    const el = webviewRef.current
    if (el?.canGoBack()) el.goBack()
  }

  function goForward(): void {
    const el = webviewRef.current
    if (el?.canGoForward()) el.goForward()
  }

  function reload(): void {
    webviewRef.current?.reload()
  }

  return (
    <div className="panel details-panel image-scraper-pane">
      <div className="toolbar image-scraper-toolbar">
        <button type="button" className="icon-btn" title="Back" onClick={goBack}>
          <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        <button type="button" className="icon-btn" title="Forward" onClick={goForward}>
          <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        <button type="button" className="icon-btn" title="Reload" onClick={reload}>
          <RefreshCw size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        <label className="image-scraper-source">
          <span className="sr-only">Scraper source</span>
          <select
            value={source}
            onChange={(e) => void onSourceChange(parseImageScraperSource(e.target.value))}
            title="Image source"
            aria-label="Image source"
          >
            <option value="pinterest">Pinterest</option>
            <option value="google">Google Images</option>
          </select>
        </label>
        <div className="image-scraper-title">
          <strong>Image Scraper</strong>
          <span className="hint">
            {props.datasetId
              ? `${sourceInfo.hint} → ${props.datasetName ?? 'dataset'}`
              : 'Select a dataset first'}
            {busyUrl ? ' · saving…' : ''}
            {lastSaved && !busyUrl ? ` · last: ${lastSaved}` : ''}
          </span>
        </div>
        <button
          type="button"
          className="icon-btn"
          title="Close scraper"
          aria-label="Close scraper"
          onClick={props.onClose}
        >
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      {!props.datasetId ? (
        <p className="hint" style={{ margin: '0.75rem 1rem' }}>
          Pick a dataset in the left library. Then click images to download them straight into that
          folder.
        </p>
      ) : null}
      {preloadPath ? (
        <webview
          key={source}
          ref={webviewRef as never}
          className="image-scraper-webview"
          src={sourceInfo.startUrl}
          preload={preloadPath}
          partition={sourceInfo.partition}
          allowpopups={false as never}
          webpreferences="contextIsolation=yes, nodeIntegration=no"
        />
      ) : (
        <p className="hint" style={{ margin: '0.75rem 1rem' }}>
          Loading browser…
        </p>
      )}
    </div>
  )
}
