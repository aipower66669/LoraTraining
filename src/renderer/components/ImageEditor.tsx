import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type MutableRefObject
} from 'react'
import FilerobotImageEditor, { TABS, TOOLS } from 'react-filerobot-image-editor'

type FilerobotToolId = (typeof TOOLS)[keyof typeof TOOLS]
import { isTypingTarget } from '@shared/keyboard'
import { unwrap, useAppStore } from '../store'
import { ConfirmDialog } from './ConfirmDialog'
import { ImageRemoveOverlay } from './ImageRemoveOverlay'
import {
  annotationEditorClaimsKey,
  editorShortcutSupersedesTyping,
  imageEditShouldWrite,
  imageEditorShortcut
} from './imageEditorShortcuts'

/** Filerobot's in-canvas annotation text box. It is mounted without being focused. */
const ANNOTATION_TEXT_EDITOR_ID = 'FIE_text-content-editor'

function annotationTextEditor(): HTMLElement | null {
  const el = document.getElementById(ANNOTATION_TEXT_EDITOR_ID)
  return el instanceof HTMLElement ? el : null
}

function focusAnnotationTextEditor(): void {
  const el = annotationTextEditor()
  if (!el?.isConnected) return
  if (el === document.activeElement || el.contains(document.activeElement)) return
  if (isTypingTarget(document.activeElement)) return
  el.focus()
}

function placeCaretInAnnotation(el: HTMLElement): void {
  const sel = window.getSelection()
  if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) return
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  sel?.removeAllRanges()
  sel?.addRange(range)
}

/** Insert the key that arrived before the text box had focus. */
function typeIntoAnnotationEditor(el: HTMLElement, e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return false
  const command =
    e.key === 'Backspace' ? 'delete' : e.key === 'Delete' ? 'forwardDelete' : null
  const lineBreak = e.key === 'Enter' && e.shiftKey
  const text = !lineBreak && e.key.length === 1 ? e.key : null
  if (!command && !lineBreak && text == null) return false
  el.focus()
  placeCaretInAnnotation(el)
  if (command) document.execCommand(command)
  else if (lineBreak) document.execCommand('insertLineBreak')
  else if (text != null) document.execCommand('insertText', false, text)
  return true
}

function forwardAnnotationKey(el: HTMLElement, e: KeyboardEvent): void {
  e.preventDefault()
  e.stopPropagation()
  el.focus()
  el.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: e.key,
      bubbles: true,
      cancelable: true,
      shiftKey: e.shiftKey
    })
  )
}

type GetCurrentImgDataFn = (
  imageFileInfo?: { name?: string; extension?: string; quality?: number },
  pixelRatio?: boolean | number,
  keepLoadingSpinnerEnabled?: boolean
) => { imageData?: { imageBase64?: string }; hideLoadingSpinner?: () => void }

/**
 * Full-window Filerobot host. Image bytes come from main via IPC once; further
 * edits stay in memory. Filerobot cannot crop a rotated design correctly
 * (upstream #267), so we bake the current canvas into the working source before
 * Crop / Remove so operations chain without Save → re-open.
 *
 * This shell rasters on the CPU (D25), so the
 * crop stage uses a 1× preview and a flat dim (no Konva blur) — a 2× blurred
 * overlay is a few software frames per second, and the move and the resize
 * paint as two separate frames.
 */
function ImageEditorInner(): JSX.Element | null {
  const editor = useAppStore((s) => s.imageEditor)
  const closeImageEditor = useAppStore((s) => s.closeImageEditor)
  const saveEditedImage = useAppStore((s) => s.saveEditedImage)
  const saveEditedImageAs = useAppStore((s) => s.saveEditedImageAs)
  const setError = useAppStore((s) => s.setError)
  const setStatus = useAppStore((s) => s.setStatus)

  // Forever-stable Filerobot callbacks — even if this host re-renders, AssemblyPoint’s
  // memo must not see new onSave/onClose/moreSaveOptions identities.
  const editorRef = useRef(editor)
  editorRef.current = editor
  const savingRef = useRef(false)
  const saveEditedImageRef = useRef(saveEditedImage)
  saveEditedImageRef.current = saveEditedImage
  const saveEditedImageAsRef = useRef(saveEditedImageAs)
  saveEditedImageAsRef.current = saveEditedImageAs
  const setErrorRef = useRef(setError)
  setErrorRef.current = setError
  const closeImageEditorRef = useRef(closeImageEditor)
  closeImageEditorRef.current = closeImageEditor

  const [src, setSrc] = useState<string | null>(null)
  const [srcKey, setSrcKey] = useState(0)
  const [defaultToolId, setDefaultToolId] = useState<FilerobotToolId>(TOOLS.CROP)
  const [saving, setSaving] = useState(false)
  const [removeMode, setRemoveMode] = useState(false)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [versionCount, setVersionCount] = useState(0)
  const [undoConfirm, setUndoConfirm] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const getImgDataRef = useRef<GetCurrentImgDataFn | null>(null)
  const dirtyRef = useRef(false)
  /** True after a crop/remove was flattened into the working image. */
  const bakedFromDiskRef = useRef(false)
  const bakingRef = useRef(false)
  const srcRef = useRef<string | null>(null)
  const removeModeRef = useRef(false)
  const removeBusyRef = useRef(false)
  const saveAsCurrentRef = useRef<() => void>(() => undefined)
  const readCurrentEditBase64Ref = useRef<() => string | null>(() => null)
  const undoLastRef = useRef<() => void>(() => undefined)
  const versionCountRef = useRef(0)
  const undoConfirmRef = useRef(false)
  versionCountRef.current = versionCount
  undoConfirmRef.current = undoConfirm
  srcRef.current = src
  removeModeRef.current = removeMode
  removeBusyRef.current = removeBusy

  const datasetId = editor?.datasetId
  const fileName = editor?.fileName

  useEffect(() => {
    if (!datasetId || !fileName) {
      setSrc(null)
      setRemoveMode(false)
      setVersionCount(0)
      setUndoConfirm(false)
      dirtyRef.current = false
      bakedFromDiskRef.current = false
      return
    }
    let alive = true
    setSrc(null)
    setRemoveMode(false)
    setVersionCount(0)
    setUndoConfirm(false)
    dirtyRef.current = false
    bakedFromDiskRef.current = false
    setDefaultToolId(TOOLS.CROP)
    void (async () => {
      try {
        const [image, state] = await Promise.all([
          window.loraTraining.imageEdit.readForEdit(datasetId, fileName),
          window.loraTraining.imageEdit.getState(datasetId, fileName)
        ])
        if (!alive) return
        const res = unwrap(image)
        const versions = unwrap(state)
        setVersionCount(versions.versionCount)
        setSrc(`data:${res.mime};base64,${res.dataBase64}`)
        setSrcKey((k) => k + 1)
      } catch (e) {
        if (alive) {
          setError(e instanceof Error ? e.message : 'Could not load image for editing')
          closeImageEditor()
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [datasetId, fileName, setError, closeImageEditor])

  const bakeWorkingSource = useCallback((nextToolId?: FilerobotToolId): boolean => {
    if (bakingRef.current) return false
    const fn = getImgDataRef.current
    if (!fn || !dirtyRef.current) {
      if (nextToolId) setDefaultToolId(nextToolId)
      return false
    }
    bakingRef.current = true
    try {
      const savedType = fileName ? extToSavedType(fileName) : 'png'
      const extension = savedType === 'jpg' ? 'jpeg' : savedType
      const result = fn(
        {
          name: 'edit',
          extension,
          quality: extension === 'jpeg' || extension === 'webp' ? 0.95 : undefined
        },
        false,
        true
      )
      result.hideLoadingSpinner?.()
      const raw = result.imageData?.imageBase64
      if (!raw) return false
      const dataUrl = raw.startsWith('data:') ? raw : `data:image/${extension};base64,${raw}`
      dirtyRef.current = false
      bakedFromDiskRef.current = true
      if (nextToolId) setDefaultToolId(nextToolId)
      setSrc(dataUrl)
      setSrcKey((k) => k + 1)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not apply edit in memory')
      return false
    } finally {
      bakingRef.current = false
    }
  }, [fileName, setError])

  const openRemoveRef = useRef<() => void>(() => undefined)
  useEffect(() => {
    openRemoveRef.current = () => {
      bakeWorkingSource()
      setRemoveMode(true)
    }
  }, [bakeWorkingSource])

  // Filename in topbar + Remove tab under Resize (same Filerobot tab chrome).
  useEffect(() => {
    if (!src || !fileName || removeMode) return
    const name = fileName
    const root = rootRef.current
    if (!root) return

    const place = (): void => {
      const wrap = root.querySelector('.FIE_topbar-buttons-wrapper')
      if (wrap) {
        let label = wrap.querySelector('.lt-edit-filename') as HTMLSpanElement | null
        if (!label) {
          label = document.createElement('span')
          label.className = 'lt-edit-filename'
          wrap.appendChild(label)
        }
        label.textContent = name
        label.title = name

        const saveBtn = wrap.querySelector('[data-testid="FIE-save-button"]')
        if (saveBtn) saveBtn.setAttribute('title', 'Save (E or Ctrl+S)')

        let saveAs = wrap.querySelector('.lt-save-as-btn') as HTMLButtonElement | null
        if (!saveAs) {
          saveAs = document.createElement('button')
          saveAs.type = 'button'
          saveAs.className = 'lt-save-as-btn'
          saveAs.textContent = 'Save as…'
          const anchor =
            wrap.querySelector('.FIE_buttons-save-btn-wrapper') ??
            wrap.querySelector('.FIE_buttons-save-btn')
          if (anchor) anchor.after(saveAs)
          else wrap.appendChild(saveAs)
        }
        saveAs.title = 'Save the current edit as a new file (same folder by default)'
        saveAs.disabled = savingRef.current
        saveAs.onclick = (ev) => {
          ev.preventDefault()
          ev.stopPropagation()
          saveAsCurrentRef.current()
        }

        let undoBtn = wrap.querySelector('.lt-undo-last-btn') as HTMLButtonElement | null
        if (versionCountRef.current < 1) {
          undoBtn?.remove()
        } else {
          if (!undoBtn) {
            undoBtn = document.createElement('button')
            undoBtn.type = 'button'
            undoBtn.className = 'lt-undo-last-btn'
            undoBtn.textContent = 'Undo last'
            const anchor =
              wrap.querySelector('.lt-save-as-btn') ??
              wrap.querySelector('.FIE_buttons-save-btn-wrapper') ??
              wrap.querySelector('.FIE_buttons-save-btn')
            if (anchor) anchor.after(undoBtn)
            else wrap.appendChild(undoBtn)
          }
          const n = versionCountRef.current
          undoBtn.textContent = n > 1 ? `Undo last (${n})` : 'Undo last'
          undoBtn.title =
            'Drop the newest saved version and open the previous one. The original file stays.'
          undoBtn.disabled = savingRef.current
          undoBtn.onclick = (ev) => {
            ev.preventDefault()
            ev.stopPropagation()
            undoLastRef.current()
          }
        }
      }

      const shortcutTitles: Array<[string, string]> = [
        ['FIE-tools-bar-item-button-crop', 'Crop (C)'],
        ['FIE-tools-bar-item-button-rotate', 'Rotate (R)'],
        ['FIE-tools-bar-item-button-flip_x', 'Flip X (F)'],
        ['FIE-tools-bar-item-button-flip_y', 'Flip Y (Shift+F)'],
        ['FIE-tab-resize', 'Resize (Z)'],
        ['FIE-tab-annotate', 'Annotate (A)'],
        ['FIE-tab-filters', 'Filters (T)'],
        ['FIE-tab-finetune', 'Finetune (U)']
      ]
      for (const [testId, title] of shortcutTitles) {
        root.querySelector(`[data-testid="${testId}"]`)?.setAttribute('title', title)
      }

      const tabs = root.querySelector('.FIE_tabs_navbar')
      if (!tabs) return
      const resizeTab =
        (tabs.querySelector('[data-testid="FIE-tab-resize"]') as HTMLElement | null) ??
        (tabs.querySelector('.FIE_tab:last-of-type') as HTMLElement | null)
      if (!resizeTab) return

      let removeTab = tabs.querySelector('.lt-remove-tab') as HTMLElement | null
      if (!removeTab) {
        removeTab = resizeTab.cloneNode(true) as HTMLElement
        removeTab.classList.add('lt-remove-tab')
        removeTab.setAttribute('aria-selected', 'false')
        removeTab.setAttribute('data-testid', 'FIE-tab-remove')
        removeTab.setAttribute('title', 'Remove (O)')
        removeTab.setAttribute('role', 'button')

        const oldSvg = removeTab.querySelector('svg')
        if (oldSvg) {
          oldSvg.outerHTML = REMOVE_TAB_ICON_SVG
        }

        const labelEl =
          (removeTab.querySelector('.FIE_tab-label') as HTMLElement | null) ??
          (removeTab.querySelector('[data-testid^="FIE-tab-item-label"]') as HTMLElement | null)
        if (labelEl) {
          labelEl.textContent = 'Remove'
          for (const span of labelEl.querySelectorAll('span')) {
            span.textContent = 'Remove'
          }
        }

        resizeTab.after(removeTab)
      }

      removeTab.onclick = (e) => {
        e.preventDefault()
        e.stopPropagation()
        openRemoveRef.current()
      }
    }

    place()
    const id = window.setInterval(place, 200)
    const stop = window.setTimeout(() => window.clearInterval(id), 4000)
    return () => {
      window.clearInterval(id)
      window.clearTimeout(stop)
    }
  }, [src, fileName, removeMode, srcKey, versionCount])

  // Bake in-memory design before Crop (Filerobot drops rotation in the crop UI).
  useEffect(() => {
    const root = rootRef.current
    if (!root || !src || removeMode) return

    const onPointerDown = (e: Event): void => {
      if (!dirtyRef.current || bakingRef.current) return
      const t = e.target
      if (!(t instanceof Element)) return
      const cropBtn = t.closest(
        '.FIE_crop-tool, [data-testid="FIE-tools-bar-item-button-crop"]'
      )
      if (!cropBtn) return
      e.preventDefault()
      e.stopPropagation()
      bakeWorkingSource(TOOLS.CROP)
    }

    root.addEventListener('pointerdown', onPointerDown, true)
    return () => root.removeEventListener('pointerdown', onPointerDown, true)
  }, [src, removeMode, srcKey, bakeWorkingSource])

  const activateAdjustTool = useCallback(
    (root: HTMLElement, toolTestId: string, bakeCrop: boolean): void => {
      if (bakeCrop && dirtyRef.current) {
        bakeWorkingSource(TOOLS.CROP)
        return
      }
      const clickTool = (): boolean => {
        const btn = root.querySelector(`[data-testid="${toolTestId}"]`) as HTMLElement | null
        if (!btn) return false
        btn.click()
        return true
      }
      if (clickTool()) return
      ;(root.querySelector('[data-testid="FIE-tab-adjust"]') as HTMLElement | null)?.click()
      let attempt = 0
      const retry = (): void => {
        if (clickTool() || attempt >= 8) return
        attempt += 1
        requestAnimationFrame(retry)
      }
      requestAnimationFrame(retry)
    },
    [bakeWorkingSource]
  )

  useEffect(() => {
    if (!editor) return
    const root = rootRef.current
    if (!root) return
    let raf = 0
    const focusText = (): void => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => focusAnnotationTextEditor())
    }
    const obs = new MutationObserver(focusText)
    obs.observe(root, { childList: true, subtree: true })
    const onFocusIn = (e: FocusEvent): void => {
      const text = annotationTextEditor()
      if (!text) return
      const target = e.target
      if (!(target instanceof Node) || text === target || text.contains(target)) return
      if (isTypingTarget(target)) return
      if (!(target instanceof Element)) return
      const stolen =
        target.closest('.konvajs-content') != null ||
        target.tagName === 'CANVAS' ||
        target.closest('.image-grid-nav') != null
      if (!stolen) return
      text.focus()
    }
    window.addEventListener('focusin', onFocusIn)
    return () => {
      cancelAnimationFrame(raf)
      obs.disconnect()
      window.removeEventListener('focusin', onFocusIn)
    }
  }, [editor, src])

  useEffect(() => {
    if (!editor) return
    const onKey = (e: KeyboardEvent): void => {
      const textEditor = annotationTextEditor()
      const targetIsEditor =
        textEditor != null &&
        (e.target === textEditor || textEditor.contains(e.target as Node))
      const targetIsTyping = isTypingTarget(e.target)
      const typing = targetIsTyping || targetIsEditor
      if (
        textEditor &&
        annotationEditorClaimsKey({
          editorOpen: true,
          targetIsEditor,
          targetIsTyping
        })
      ) {
        if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
          forwardAnnotationKey(textEditor, e)
          return
        }
        if (typeIntoAnnotationEditor(textEditor, e)) {
          e.preventDefault()
          e.stopPropagation()
          return
        }
        const pending = imageEditorShortcut(e)
        if (!pending || !editorShortcutSupersedesTyping(pending, e)) {
          textEditor.focus()
          e.preventDefault()
          e.stopPropagation()
          return
        }
      }
      if (e.key === 'Escape') {
        if (undoConfirmRef.current) return
        if (removeBusy || saving) {
          e.preventDefault()
          e.stopPropagation()
          return
        }
        if (removeMode) {
          e.preventDefault()
          setRemoveMode(false)
          return
        }
        // Escape leaves the text box; Filerobot handles that. A second Escape closes.
        if (typing || textEditor) return
        e.preventDefault()
        closeImageEditor()
        return
      }

      const action = imageEditorShortcut(e)
      if (!action) return
      // Letter keys type into resize fields and the annotation text box.
      // Ctrl/Cmd-S still saves from a field.
      if ((typing || textEditor) && !editorShortcutSupersedesTyping(action, e)) return
      e.preventDefault()
      e.stopPropagation()
      if (removeBusy || savingRef.current) return

      if (action === 'save') {
        const btn = rootRef.current?.querySelector(
          '[data-testid="FIE-save-button"]'
        ) as HTMLElement | null
        if (btn) {
          btn.click()
          return
        }
        const data = readCurrentEditBase64Ref.current()
        const ed = editorRef.current
        if (!data || !ed) return
        if (!imageEditShouldWrite({ hasUndo: dirtyRef.current, bakedFromDisk: bakedFromDiskRef.current })) {
          closeImageEditorRef.current()
          return
        }
        void saveEditedImageRef.current(ed.datasetId, ed.fileName, data)
        return
      }

      if (removeMode) return
      const root = rootRef.current
      if (!root) return
      if (action === 'remove') {
        openRemoveRef.current()
        return
      }
      if (action === 'crop') {
        activateAdjustTool(root, 'FIE-tools-bar-item-button-crop', true)
        return
      }
      if (action === 'rotate') {
        activateAdjustTool(root, 'FIE-tools-bar-item-button-rotate', false)
        return
      }
      if (action === 'flip-x') {
        activateAdjustTool(root, 'FIE-tools-bar-item-button-flip_x', false)
        return
      }
      if (action === 'flip-y') {
        activateAdjustTool(root, 'FIE-tools-bar-item-button-flip_y', false)
        return
      }
      const tabId =
        action === 'resize'
          ? 'FIE-tab-resize'
          : action === 'annotate'
            ? 'FIE-tab-annotate'
            : action === 'filters'
              ? 'FIE-tab-filters'
              : 'FIE-tab-finetune'
      ;(root.querySelector(`[data-testid="${tabId}"]`) as HTMLElement | null)?.click()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [editor, saving, removeMode, removeBusy, closeImageEditor, activateAdjustTool])

  const runSaveAs = useCallback(async (dataBase64: string | undefined) => {
    const ed = editorRef.current
    if (!ed || !dataBase64) {
      setErrorRef.current('Editor returned no image data')
      return
    }
    setSaving(true)
    savingRef.current = true
    try {
      await saveEditedImageAsRef.current(ed.datasetId, ed.fileName, dataBase64)
    } catch {
      // notify already done in store
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [])

  /** Pixels currently in the editor (crop, flip, filters), not the file on disk. */
  const readCurrentEditBase64 = useCallback((): string | null => {
    if (removeModeRef.current) return srcRef.current
    const fn = getImgDataRef.current
    if (!fn) return null
    try {
      const savedType = fileName ? extToSavedType(fileName) : 'png'
      const extension = savedType === 'jpg' ? 'jpeg' : savedType
      const result = fn(
        {
          name: 'edit',
          extension,
          quality: extension === 'jpeg' || extension === 'webp' ? 0.92 : undefined
        },
        false,
        true
      )
      result.hideLoadingSpinner?.()
      return result.imageData?.imageBase64 ?? null
    } catch (e) {
      setErrorRef.current(e instanceof Error ? e.message : 'Could not read the edited image')
      return null
    }
  }, [fileName])

  readCurrentEditBase64Ref.current = readCurrentEditBase64

  const applyUndoLast = useCallback(async () => {
    const ed = editorRef.current
    if (!ed || savingRef.current || versionCountRef.current < 1) return
    setUndoConfirm(false)
    setSaving(true)
    savingRef.current = true
    try {
      const dropped = unwrap(
        await window.loraTraining.imageEdit.undoLast(ed.datasetId, ed.fileName)
      )
      const res = unwrap(
        await window.loraTraining.imageEdit.readForEdit(ed.datasetId, ed.fileName)
      )
      dirtyRef.current = false
      bakedFromDiskRef.current = false
      setRemoveMode(false)
      setDefaultToolId(TOOLS.CROP)
      setVersionCount(dropped.versionCount)
      setSrc(`data:${res.mime};base64,${res.dataBase64}`)
      setSrcKey((k) => k + 1)
      setStatus(
        dropped.versionCount > 0
          ? `Undid last edit · ${dropped.versionCount} version${dropped.versionCount === 1 ? '' : 's'} left`
          : `Undid last edit · ${ed.fileName}`
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not undo the last edit')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [setError, setStatus])

  undoLastRef.current = () => {
    if (savingRef.current || versionCountRef.current < 1) return
    if (dirtyRef.current || bakedFromDiskRef.current) {
      setUndoConfirm(true)
      return
    }
    void applyUndoLast()
  }

  saveAsCurrentRef.current = () => {
    if (savingRef.current || removeBusyRef.current) return
    const data = readCurrentEditBase64()
    if (!data) {
      setErrorRef.current('Editor returned no image data')
      return
    }
    void runSaveAs(data)
  }

  const tabsIds = useMemo(
    () => [TABS.ADJUST, TABS.FINETUNE, TABS.FILTERS, TABS.ANNOTATE, TABS.RESIZE],
    []
  )
  const cropConfig = useMemo(
    () => ({
      ratio: 'custom' as const,
      ratioTitleKey: 'custom',
      noPresets: true,
      autoResize: true,
      // boundResizing multiplies the image box by canvasScale unless this is set.
      // The initial fit already passes noScale; the live handle path did not.
      noScale: true
    }),
    []
  )
  const editorTheme = useMemo(
    () => ({
      palette: {
        'bg-primary': '#0f1115',
        'bg-secondary': '#171a21',
        'accent-primary': '#4f8cff',
        'borders-secondary': '#2a2f3a',
        'text-primary': '#e6e9ef',
        'text-secondary': '#9aa3b2'
      }
    }),
    []
  )
  const savingPixelRatio = useMemo(() => Math.min(2, window.devicePixelRatio || 1), [])
  const onEditorModify = useCallback((state: object) => {
    dirtyRef.current = Boolean(
      'hasUndo' in state && (state as { hasUndo?: boolean }).hasUndo
    )
  }, [])
  const onBeforeSave = useCallback(() => false, [])
  const onSave = useCallback(async (imageData: { imageBase64?: string }) => {
    const ed = editorRef.current
    if (!ed) return
    if (!imageEditShouldWrite({ hasUndo: dirtyRef.current, bakedFromDisk: bakedFromDiskRef.current })) {
      closeImageEditorRef.current()
      return
    }
    const data = imageData.imageBase64
    if (!data || !ed) {
      setErrorRef.current('Editor returned no image data')
      return
    }
    setSaving(true)
    savingRef.current = true
    try {
      await saveEditedImageRef.current(ed.datasetId, ed.fileName, data)
    } catch {
      // notify already done in store
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [])
  const onClose = useCallback(() => {
    if (!savingRef.current) closeImageEditorRef.current()
  }, [])

  if (!editor) return null

  const name = editor.fileName

  return (
    <div
      ref={rootRef}
      className="image-editor"
      role="dialog"
      aria-label={`Edit ${name}`}
    >
      <div className="image-editor-body">
        {!src ? (
          <div className="image-editor-loading">Loading…</div>
        ) : removeMode ? (
          <ImageRemoveOverlay
            imageSrc={src}
            busy={removeBusy}
            onBusy={setRemoveBusy}
            onStatus={setStatus}
            onError={setError}
            onCancel={() => setRemoveMode(false)}
            onApplied={(dataUrl) => {
              dirtyRef.current = false
              bakedFromDiskRef.current = true
              setSrc(dataUrl)
              setSrcKey((k) => k + 1)
              setDefaultToolId(TOOLS.CROP)
              setRemoveMode(false)
              setStatus('Remove applied — Save when ready')
            }}
          />
        ) : (
          <FilerobotImageEditor
            key={srcKey}
            source={src}
            tabsIds={tabsIds}
            defaultTabId={TABS.ADJUST}
            defaultToolId={defaultToolId}
            useAiTab={false}
            closeAfterSave
            avoidChangesNotSavedAlertOnLeave
            resetOnSourceChange={false}
            getCurrentImgDataFnRef={getImgDataRef as MutableRefObject<GetCurrentImgDataFn | null>}
            onModify={onEditorModify}
            onBeforeSave={onBeforeSave}
            defaultSavedImageName={name.replace(/\.[^.]+$/, '') || name}
            defaultSavedImageType={extToSavedType(name)}
            savingPixelRatio={savingPixelRatio}
            previewPixelRatio={1}
            Crop={cropConfig}
            theme={editorTheme}
            onSave={onSave}
            onClose={onClose}
          />
        )}
      </div>
      <ConfirmDialog
        open={undoConfirm}
        title="Undo last edit?"
        confirmLabel="Undo last"
        danger
        onConfirm={() => void applyUndoLast()}
        onCancel={() => setUndoConfirm(false)}
      >
        This drops the newest saved version and opens the previous one. Unsaved changes in
        this window are discarded. The original file stays.
      </ConfirmDialog>
    </div>
  )
}

/** Inline eraser icon matching Filerobot tab icon size (24). */
const REMOVE_TAB_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-testid="FIE-tab-item-icon-remove" aria-hidden="true"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>`

function extToSavedType(filePath: string): 'png' | 'jpeg' | 'jpg' | 'webp' {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? 'png'
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'jfif' || ext === 'bmp') return 'jpeg'
  if (ext === 'webp') return 'webp'
  return 'png'
}

/** No props — memo blocks App’s high-frequency re-renders from reaching Filerobot. */
export const ImageEditor = memo(ImageEditorInner)
