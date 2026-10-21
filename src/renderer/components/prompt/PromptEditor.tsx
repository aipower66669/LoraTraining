import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent
} from 'react'
import {
  Decoration,
  EditorView,
  WidgetType,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  rectangularSelection,
  tooltips
} from '@codemirror/view'
import {
  Annotation,
  Compartment,
  EditorState,
  type Extension
} from '@codemirror/state'
import {
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting
} from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { openSearchPanel, searchKeymap } from '@codemirror/search'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  redoDepth,
  selectAll,
  undo,
  undoDepth
} from '@codemirror/commands'
import {
  autocompletion,
  acceptCompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type CompletionSource
} from '@codemirror/autocomplete'
import { ClipboardCopy, ClipboardPaste, Redo2, Scissors, Undo2 } from 'lucide-react'
import { wildcardLanguage } from './wildcardLang'

/** Marks doc updates that come from React props, not the user. */
const externalValueAnnotation = Annotation.define<boolean>()

export type PromptEditorHandle = {
  focus: () => void
  getValue: () => string
  setExternalValue: (text: string) => void
}

type Props = {
  value: string
  onChange?: (value: string) => void
  onBlur?: () => void
  readOnly?: boolean
  placeholder?: string
  /** Keys offered after opening `__`. */
  wildcardKeys?: string[]
  className?: string
}

type EditorContextMenu = {
  x: number
  y: number
  canCut: boolean
  canCopy: boolean
  canPaste: boolean
  canUndo: boolean
  canRedo: boolean
}

/**
 * Same idea as CodeMirror's basicSetup, but without highlightSelectionMatches /
 * line numbers — prompt fields are compact like textareas.
 */
const editorSetup: Extension = [
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  bracketMatching(),
  closeBrackets(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...completionKeymap
  ])
]

function wildcardCompletionSource(getKeys: () => string[]): CompletionSource {
  return (context) => {
    const line = context.state.doc.lineAt(context.pos)
    const beforeCursor = context.state.sliceDoc(line.from, context.pos)
    const delimiterCount = beforeCursor.match(/__/g)?.length ?? 0
    // Odd count => cursor is inside an open `__...` (not after a closed `__key__`).
    if (delimiterCount % 2 === 0) return null

    const match = context.matchBefore(/__(?:[^_\n]|_(?!_))*$/)
    if (!match) return null

    const keys = getKeys()
    const options =
      keys.length > 0
        ? keys.map((key) => ({
            label: key,
            type: 'variable' as const,
            apply: `${key}__`
          }))
        : [
            {
              label: '(No wildcards — set Settings → ComfyUI → Wildcards folder)',
              type: 'text' as const,
              apply: '',
              boost: -99
            }
          ]

    const closesAtCursor =
      context.state.sliceDoc(
        context.pos,
        Math.min(context.state.doc.length, context.pos + 2)
      ) === '__'

    return {
      from: match.from + 2,
      to: context.pos + (closesAtCursor ? 2 : 0),
      options,
      // Keep the popup open while typing the key; CM still filters by label.
      validFor: /(?:[^_\n]|_(?!_))*/
    }
  }
}

class PlaceholderWidget extends WidgetType {
  constructor(readonly text: string) {
    super()
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-placeholder'
    span.textContent = this.text
    return span
  }
  eq(other: PlaceholderWidget): boolean {
    return other.text === this.text
  }
  ignoreEvent(): boolean {
    return false
  }
}

function placeholderExt(text: string): Extension {
  return EditorView.decorations.compute(['doc'], (state) => {
    if (!text || state.doc.length > 0) return Decoration.none
    return Decoration.set([
      Decoration.widget({
        widget: new PlaceholderWidget(text),
        side: 1
      }).range(0)
    ])
  })
}

const highlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#7cc4ff', fontWeight: '600' },
  { tag: t.comment, color: '#8a949f', fontStyle: 'italic' },
  { tag: t.tagName, color: '#c792ea', fontWeight: '600' },
  { tag: t.special(t.variableName), color: '#7ee0c3', fontWeight: '600' },
  { tag: t.number, color: '#ffb86c' },
  { tag: t.meta, color: '#f28fad' },
  { tag: t.bracket, color: '#c792ea', fontWeight: '600' },
  { tag: t.string, color: '#a5e075' }
])

const editorTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      fontSize: '13px',
      backgroundColor: 'transparent',
      color: 'var(--text)'
    },
    '.cm-scroller': {
      fontFamily: 'var(--font)',
      lineHeight: '1.35',
      overflow: 'auto'
    },
    '.cm-content': {
      caretColor: 'var(--text)',
      padding: '0.4rem 0.55rem',
      minHeight: '100%'
    },
    '.cm-placeholder': {
      color: 'var(--text-dim)',
      fontStyle: 'italic',
      pointerEvents: 'none'
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(255, 255, 255, 0.03)'
    },
    '.cm-content ::selection': {
      backgroundColor: 'transparent',
      color: 'inherit'
    },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, & > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
      {
        backgroundColor: 'rgba(79, 140, 255, 0.35) !important'
      },
    '.cm-cursor': {
      borderLeftColor: 'var(--text)'
    },
    '.cm-matchingBracket': {
      backgroundColor: 'rgba(62, 207, 142, 0.18)',
      outline: '1px solid rgba(62, 207, 142, 0.45)'
    },
    '&.cm-focused': {
      outline: 'none'
    },
    '.cm-tooltip.cm-tooltip-autocomplete': {
      zIndex: 10001,
      border: '1px solid var(--border)',
      backgroundColor: 'var(--bg-elevated)',
      color: 'var(--text)',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)'
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'var(--accent)',
      color: '#ffffff'
    }
  },
  { dark: true }
)

export const PromptEditor = forwardRef<PromptEditorHandle, Props>(
  function PromptEditor(
    {
      value,
      onChange,
      onBlur,
      readOnly = false,
      placeholder = '',
      wildcardKeys = [],
      className
    },
    ref
  ) {
    const hostRef = useRef<HTMLDivElement | null>(null)
    const viewRef = useRef<EditorView | null>(null)
    const menuRef = useRef<HTMLDivElement | null>(null)
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange
    const wildcardKeysRef = useRef(wildcardKeys)
    wildcardKeysRef.current = wildcardKeys
    const editableCompartment = useRef(new Compartment()).current
    const placeholderCompartment = useRef(new Compartment()).current
    const [contextMenu, setContextMenu] = useState<EditorContextMenu | null>(null)
    const readOnlyRef = useRef(readOnly)
    readOnlyRef.current = readOnly

    useImperativeHandle(ref, () => ({
      focus() {
        viewRef.current?.focus()
      },
      getValue() {
        return viewRef.current?.state.doc.toString() ?? ''
      },
      setExternalValue(text: string) {
        const view = viewRef.current
        if (!view) return
        const current = view.state.doc.toString()
        if (current === text) return
        view.dispatch({
          changes: { from: 0, to: current.length, insert: text },
          annotations: externalValueAnnotation.of(true)
        })
      }
    }))

    const openEditorContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      const view = viewRef.current
      if (!view) return

      const clickPos =
        view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
        view.state.selection.main.head
      const { from, to } = view.state.selection.main
      const clickInsideSelection =
        from !== to &&
        clickPos >= Math.min(from, to) &&
        clickPos <= Math.max(from, to)
      if (!clickInsideSelection) {
        view.dispatch({ selection: { anchor: clickPos, head: clickPos } })
      }
      view.focus()

      const { state } = view
      const hasSelection = state.selection.ranges.some((r) => !r.empty)
      const editable = !readOnlyRef.current && !state.readOnly
      setContextMenu({
        x: Math.max(8, Math.min(event.clientX, window.innerWidth - 200)),
        y: Math.max(8, Math.min(event.clientY, window.innerHeight - 220)),
        canCut: editable && hasSelection,
        canCopy: hasSelection,
        canPaste: editable,
        canUndo: editable && undoDepth(state) > 0,
        canRedo: editable && redoDepth(state) > 0
      })
    }

    const runEditorCommand = (
      action: 'cut' | 'copy' | 'paste' | 'selectAll' | 'undo' | 'redo'
    ) => {
      const view = viewRef.current
      setContextMenu(null)
      if (!view) return
      view.focus()

      if (action === 'selectAll') {
        selectAll(view)
        return
      }
      if (action === 'undo') {
        undo(view)
        return
      }
      if (action === 'redo') {
        redo(view)
        return
      }

      const { state } = view
      const selected = state.selection.ranges
        .filter((r) => !r.empty)
        .map((r) => state.sliceDoc(r.from, r.to))
        .join('\n')

      if (action === 'copy') {
        if (!selected) return
        void navigator.clipboard.writeText(selected)
        return
      }

      if (action === 'cut') {
        if (state.readOnly || !selected) return
        void navigator.clipboard.writeText(selected).then(() => {
          view.dispatch(view.state.replaceSelection(''))
        })
        return
      }

      if (action === 'paste') {
        if (state.readOnly) return
        void navigator.clipboard.readText().then((text) => {
          if (!text) return
          view.dispatch(view.state.replaceSelection(text))
        })
      }
    }

    useEffect(() => {
      if (!contextMenu) return

      const close = (event: Event) => {
        if (
          event.type === 'pointerdown' &&
          menuRef.current?.contains(event.target as globalThis.Node)
        ) {
          return
        }
        setContextMenu(null)
      }
      const closeOnEscape = (event: KeyboardEvent) => {
        if (event.key === 'Escape') setContextMenu(null)
      }

      window.addEventListener('pointerdown', close)
      window.addEventListener('blur', close)
      window.addEventListener('resize', close)
      window.addEventListener('scroll', close, true)
      window.addEventListener('keydown', closeOnEscape)
      window.setTimeout(() => {
        menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
      }, 0)

      return () => {
        window.removeEventListener('pointerdown', close)
        window.removeEventListener('blur', close)
        window.removeEventListener('resize', close)
        window.removeEventListener('scroll', close, true)
        window.removeEventListener('keydown', closeOnEscape)
      }
    }, [contextMenu])

    useEffect(() => {
      if (!hostRef.current) return

      const state = EditorState.create({
        doc: value,
        extensions: [
          editorSetup,
          syntaxHighlighting(highlightStyle),
          wildcardLanguage,
          // Render the popup on document.body so panel overflow cannot clip it.
          tooltips({ parent: document.body }),
          autocompletion({
            override: [wildcardCompletionSource(() => wildcardKeysRef.current)],
            activateOnTyping: true,
            activateOnTypingDelay: 0,
            maxRenderedOptions: 100,
            closeOnBlur: true,
            defaultKeymap: true
          }),
          placeholderCompartment.of(placeholderExt(placeholder)),
          editorTheme,
          keymap.of([
            { key: 'Tab', run: acceptCompletion },
            indentWithTab,
            { key: 'Mod-f', run: openSearchPanel }
          ]),
          editableCompartment.of([
            EditorView.editable.of(!readOnly),
            EditorState.readOnly.of(readOnly)
          ]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return
            const fromExternal = update.transactions.some((tr) =>
              tr.annotation(externalValueAnnotation)
            )
            if (fromExternal) return
            onChangeRef.current?.(update.state.doc.toString())
          }),
          EditorView.lineWrapping
        ]
      })

      const view = new EditorView({ state, parent: hostRef.current })
      viewRef.current = view

      return () => {
        view.destroy()
        viewRef.current = null
      }
      // Mount once; parent remounts via key if needed.
       
    }, [])

    useEffect(() => {
      const view = viewRef.current
      if (!view) return
      const current = view.state.doc.toString()
      if (current === value) return
      if (view.hasFocus) return
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
        annotations: externalValueAnnotation.of(true)
      })
    }, [value])

    useEffect(() => {
      const view = viewRef.current
      if (!view) return
      view.dispatch({
        effects: editableCompartment.reconfigure([
          EditorView.editable.of(!readOnly),
          EditorState.readOnly.of(readOnly)
        ])
      })
    }, [readOnly, editableCompartment])

    useEffect(() => {
      const view = viewRef.current
      if (!view) return
      view.dispatch({
        effects: placeholderCompartment.reconfigure(placeholderExt(placeholder))
      })
    }, [placeholder, placeholderCompartment])

    return (
      <>
        <div
          ref={hostRef}
          className={className ?? 'prompt-editor'}
          data-readonly={readOnly ? 'true' : 'false'}
          onContextMenu={openEditorContextMenu}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) onBlur?.()
          }}
        />
        {contextMenu ? (
          <div
            ref={menuRef}
            className="prompt-editor-context-menu"
            role="menu"
            aria-label="Editor actions"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onContextMenu={(event) => event.preventDefault()}
          >
            {!readOnly ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!contextMenu.canUndo}
                  onClick={() => runEditorCommand('undo')}
                >
                  <Undo2 size={14} /> Undo
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!contextMenu.canRedo}
                  onClick={() => runEditorCommand('redo')}
                >
                  <Redo2 size={14} /> Redo
                </button>
                <div className="prompt-editor-context-sep" role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  disabled={!contextMenu.canCut}
                  onClick={() => runEditorCommand('cut')}
                >
                  <Scissors size={14} /> Cut
                </button>
              </>
            ) : null}
            <button
              type="button"
              role="menuitem"
              disabled={!contextMenu.canCopy}
              onClick={() => runEditorCommand('copy')}
            >
              <ClipboardCopy size={14} /> Copy
            </button>
            {!readOnly ? (
              <button
                type="button"
                role="menuitem"
                disabled={!contextMenu.canPaste}
                onClick={() => runEditorCommand('paste')}
              >
                <ClipboardPaste size={14} /> Paste
              </button>
            ) : null}
            <div className="prompt-editor-context-sep" role="separator" />
            <button type="button" role="menuitem" onClick={() => runEditorCommand('selectAll')}>
              Select all
            </button>
          </div>
        ) : null}
      </>
    )
  }
)
