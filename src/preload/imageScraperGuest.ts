/**
 * Guest preload for the Image Scraper <webview> (Pinterest + Google Images).
 * Runs in the guest world; reports image clicks to the host via sendToHost.
 */
import { ipcRenderer } from 'electron'
import { resolveScrapedImageUrl } from '@shared/image-scraper'

function collectHrefs(from: Element): string[] {
  const out: string[] = []
  let el: Element | null = from
  for (let i = 0; el && i < 8; i++) {
    if (el instanceof HTMLAnchorElement && el.href) out.push(el.href)
    const nested = el.querySelector?.('a[href]')
    if (nested instanceof HTMLAnchorElement && nested.href) out.push(nested.href)
    el = el.parentElement
  }
  return out
}

function dataAttrs(img: HTMLImageElement): Record<string, string | null> {
  return {
    'data-ou': img.getAttribute('data-ou'),
    'data-iurl': img.getAttribute('data-iurl'),
    'data-src': img.getAttribute('data-src'),
    'data-iml': img.getAttribute('data-iml')
  }
}

function findImage(target: EventTarget | null): HTMLImageElement | null {
  if (!(target instanceof Element)) return null
  if (target instanceof HTMLImageElement) return target
  const inner = target.querySelector?.('img')
  if (inner instanceof HTMLImageElement) return inner
  return target.closest('img')
}

function onClick(e: MouseEvent): void {
  // Only primary button.
  if (e.button !== 0) return
  const img = findImage(e.target)
  if (!img) return

  const resolved = resolveScrapedImageUrl({
    src: img.getAttribute('src'),
    currentSrc: img.currentSrc,
    srcset: img.getAttribute('srcset'),
    dataAttrs: dataAttrs(img),
    hrefs: collectHrefs(img),
    pageUrl: typeof location !== 'undefined' ? location.href : ''
  })
  if (!resolved) return

  e.preventDefault()
  e.stopPropagation()
  e.stopImmediatePropagation()

  ipcRenderer.sendToHost('scrape-image', {
    url: resolved.url,
    pageUrl: typeof location !== 'undefined' ? location.href : '',
    trustAsImage: resolved.trustAsImage === true
  })
}

function install(): void {
  const w = window as unknown as { __loraImageScraper?: boolean }
  if (w.__loraImageScraper) return
  w.__loraImageScraper = true
  document.addEventListener('click', onClick, true)
}

install()
document.addEventListener('DOMContentLoaded', install)
