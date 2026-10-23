/**
 * Filerobot patches (re-apply after npm install). Clears Vite’s deps cache so
 * the patched sources are what the app loads.
 *
 * 1. Crop: free-form corners (independent width/height). Upstream
 *    `keepRatio={!isCustom || !isEllipse}` is always true for custom.
 *    Handle drags also ignore config rebuilds until pointer-up so the box
 *    cannot snap back to the gesture start.
 * 2. Resize: ratio lock must use the *current* (cropped) size, not the
 *    original file. Otherwise e.g. 500×1000 crop becomes 499×499 when width
 *    is edited while locked (Scaleflex PR #567).
 * 3. Annotate: the dragged text box keeps that size and the same handles as a
 *    rectangle. The text box takes keyboard focus when it is opened.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  patchFilerobotCropSource,
  patchFilerobotResizeSource,
  patchFilerobotTextBoxSizeSource,
  patchFilerobotTextEditorFocusSource,
  patchFilerobotTextNodeSizeSource,
  restoreFilerobotTextSelectionSource
} from './filerobotPatches.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const fieLib = path.join(root, 'node_modules', 'react-filerobot-image-editor', 'lib')

function clearViteDepsCache() {
  // Wipe the whole deps dir (not only filerobot files). Deleting the prebundle
  // while leaving `_metadata.json` pointing at it breaks ImageEditor load.
  const deps = path.join(root, 'node_modules', '.vite', 'deps')
  if (!fs.existsSync(deps)) return
  fs.rmSync(deps, { recursive: true, force: true })
  console.log(
    '[patch-filerobot] cleared Vite deps cache (restart/reload so it re-optimizes)'
  )
}

function patchFile(rel, patchFn, okNeedle) {
  const file = path.join(fieLib, rel)
  if (!fs.existsSync(file)) {
    console.warn(`[patch-filerobot] ${rel} not found; skip`)
    return
  }
  const before = fs.readFileSync(file, 'utf8')
  const after = patchFn(before)
  if (after !== before) {
    fs.writeFileSync(file, after)
    console.log(`[patch-filerobot] patched ${rel}`)
  } else if (okNeedle && after.includes(okNeedle)) {
    console.log(`[patch-filerobot] ${rel} already patched`)
  } else {
    console.warn(`[patch-filerobot] ${rel}: patterns not found — check upstream`)
  }
}

patchFile(
  path.join('components', 'Layers', 'TransformersLayer', 'CropTransformer.js'),
  patchFilerobotCropSource,
  'cropGesture=useRef(!1)'
)
patchFile(
  path.join('components', 'tools', 'Resize', 'Resize.js'),
  patchFilerobotResizeSource,
  's.width/s.height'
)
patchFile(
  path.join(
    'components',
    'Layers',
    'DesignLayer',
    'AnnotationNodes',
    'TextNode',
    'TextNodeContentTextarea.js'
  ),
  patchFilerobotTextEditorFocusSource,
  'p.current.focus()'
)
patchFile(
  path.join('actions', 'setAnnotation.js'),
  restoreFilerobotTextSelectionSource,
  'selectionsIds:void 0!==g&&g?[o.id]:a.selectionsIds'
)
patchFile(
  path.join('hooks', 'useAnnotation', 'previewThenCallAnnotationAdding.js'),
  patchFilerobotTextBoxSizeSource,
  'textBox=textAnnotationWrappedRect'
)
patchFile(
  path.join(
    'components',
    'Layers',
    'DesignLayer',
    'AnnotationNodes',
    'TextNode',
    'index.js'
  ),
  patchFilerobotTextNodeSizeSource,
  'p=null!=o&&0!==o?o:void 0'
)

// Filerobot pins konva 9.3.18 while the app has 9.3.22, so npm nests a second
// copy. The text shape then registers on the copy react-konva does not draw,
// and a new text box becomes an empty group (two handles, no letters, no size).
const nestedKonva = path.join(fieLib, '..', 'node_modules', 'konva')
if (fs.existsSync(nestedKonva)) {
  fs.rmSync(nestedKonva, { recursive: true, force: true })
  console.log('[patch-filerobot] removed nested konva so text uses the app Konva')
}

clearViteDepsCache()
