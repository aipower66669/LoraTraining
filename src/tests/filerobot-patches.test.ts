import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { Konva } from 'konva/lib/Global.js'
import {
  patchFilerobotCropSource,
  patchFilerobotResizeSource,
  patchFilerobotTextBoxSizeSource,
  patchFilerobotTextEditorFocusSource,
  patchFilerobotTextNodeSizeSource,
  restoreFilerobotTextSelectionSource
} from '../../scripts/filerobotPatches.mjs'

const CROP_FIXTURE = [
  'r=useRef(),s=useRef(),t=useRef(),u=useRef(),v=p',
  'useEffect(function(){return e&&s.current&&r.current&&(t.current&&t.current.cache(),s.current.nodes([r.current])),function(){t.current&&t.current.clearCache()}},[e,f,g])',
  'useEffect(function(){if(g&&(u.current=g,"undefined"!=typeof g.x&&g.width)){var a,b;F(1)}},[A,g,w])',
  'var L=G,M=L.x,N=void 0===M?0:M,x=L.y,O=void 0===x?0:x,y=L.width,P=L.height,Q={x:N,y:O,ref:r,fill:"#FFFFFF",scaleX:1,scaleY:1,globalCompositeOperation:"destination-out",onDragEnd:z?void 0:I,onDragMove:z?void 0:function b(a){var c=a.target;c.setAttrs(boundDragging(c.attrs,u.current))},onTransformEnd:z?void 0:I,draggable:!z}',
  'nodes:r.current?[r.current]:[],keepRatio:!B||!C,shiftBehavior:B||C?"none":"default"',
  'customFilters:[Konva.Filters.Blur,Konva.Filters.Brighten],customFinetuneProps:{blurRadius:10,brightness:-.15}'
].join('')

describe('patchFilerobotCropSource', () => {
  it('keeps the live crop box while a handle drag is in progress', () => {
    const out = patchFilerobotCropSource(CROP_FIXTURE)
    expect(out).toContain('cropGesture=useRef(!1)')
    expect(out).toContain('if(cropGesture.current)return')
    expect(out).toContain('!cropGesture.current&&')
    expect(out).toContain('nodes:nodesHold.current')
    expect(out).toContain('scaleX:cropScaleX,scaleY:cropScaleY')
    expect(out).toContain('}var Q={')
    expect(out).not.toContain('}Q={')
    expect(out).toContain('customFinetuneProps:{opacity:.45}')
    expect(out).not.toContain('Konva.Filters.Blur')
    expect(out).not.toContain('nodes:r.current?[r.current]:[]')
    expect(patchFilerobotCropSource(out)).toBe(out)
  })
})

describe('patchFilerobotResizeSource', () => {
  it('locks ratio to current dimensions (s), not original file (m)', () => {
    const src =
      'var h=Math.min(10*j.width,10*j.height),m=getSizeAfterRotation(j.width,j.height,p),o="height"===f,q=o?"width":"height",r=_defineProperty(_defineProperty({},f,g?restrictNumber(g,0,h):g),q,s[q]),t=k.ratioUnlocked;if(!t){var u=m.width/m.height;r[q]=o?Math.round(r[f]*u):Math.round(r[f]/u)}'
    const out = patchFilerobotResizeSource(src)
    expect(out).toContain('s.width/s.height')
    expect(out).not.toContain('m.width/m.height')
    expect(out).not.toContain('getSizeAfterRotation(j.width,j.height,p)')
    expect(out).toContain('Number(r[f])')
  })
})

describe('patchFilerobotTextBoxSizeSource', () => {
  it('keeps the dragged text box size and rectangle handles', () => {
    const src =
      'm=function c(){var e,f;if(j(),latest){NO_WIDTH_HEIGHT_ANNOTATIONS.includes(b.name)||(s.width=q,s.height=r),d(s,!0)}}'
    const out = patchFilerobotTextBoxSizeSource(src)
    expect(out.indexOf('textBox=textAnnotationWrappedRect')).toBeLessThan(out.indexOf('if(j()'))
    expect(out).toContain('s.autoWidth=!1,s.autoHeight=!1')
    expect(out).not.toContain('s.strokeWidth=2')
    expect(patchFilerobotTextBoxSizeSource(out)).toBe(out)
  })

  it('stops reading the preview rect after it is destroyed', () => {
    const src =
      'm=function c(){var e,f;if(j(),x){b.name===TOOLS_IDS.TEXT&&textAnnotationWrappedRect&&(s.x=textAnnotationWrappedRect.x(),s.y=textAnnotationWrappedRect.y(),s.width=Math.abs(textAnnotationWrappedRect.width()),s.height=Math.abs(textAnnotationWrappedRect.height()),s.autoWidth=!1,s.autoHeight=!1,s.strokeWidth=2)}}'
    const out = patchFilerobotTextBoxSizeSource(src)
    expect(out).toContain('textBox.width')
    expect(out.indexOf('textAnnotationWrappedRect.width()')).toBeLessThan(out.indexOf('if(j()'))
    expect(out.slice(out.indexOf('if(j()'))).not.toContain('textAnnotationWrappedRect')
    expect(out).not.toContain('strokeWidth=2')
    expect(patchFilerobotTextBoxSizeSource(out)).toBe(out)
  })
})

describe('patchFilerobotTextNodeSizeSource', () => {
  it('does not turn a missing text size into a zero box', () => {
    const src = 'o=a.width,p=void 0===o?0:o,q=a.height,r=void 0===q?0:q'
    const out = patchFilerobotTextNodeSizeSource(src)
    expect(out).toContain('p=null!=o&&0!==o?o:void 0')
    expect(out).toContain('r=null!=q&&0!==q?q:void 0')
    expect(patchFilerobotTextNodeSizeSource(out)).toBe(out)
  })
})

describe('restoreFilerobotTextSelectionSource', () => {
  it('keeps a new text box selected so the move handles stay', () => {
    const opened =
      'selectionsIds:l&&"Text"===o.name&&g?[]:void 0!==g&&g?[o.id]:a.selectionsIds,textIdOfEditableContent:l&&"Text"===o.name&&g?o.id:a.textIdOfEditableContent'
    const out = restoreFilerobotTextSelectionSource(`return {${opened}}`)
    expect(out).toContain('selectionsIds:void 0!==g&&g?[o.id]:a.selectionsIds')
    expect(out).not.toContain('textIdOfEditableContent:l&&"Text"===o.name')
    expect(restoreFilerobotTextSelectionSource(out)).toBe(out)
  })
})

describe('text shape registration', () => {
  it('registers FormattedText on the same Konva react-konva draws with', async () => {
    await import('react-filerobot-image-editor/lib/custom/shapes/FormattedText.js')
    expect(typeof Konva.FormattedTextFIE).toBe('function')
    const require = createRequire(import.meta.url)
    const filerobotPkg = require.resolve('react-filerobot-image-editor/package.json')
    expect(require.resolve('konva/package.json', { paths: [filerobotPkg] })).toBe(
      require.resolve('konva/package.json')
    )
  })
})

describe('patchFilerobotTextEditorFocusSource', () => {
  it('focuses the annotation text box when it mounts', () => {
    const src =
      'C=useCallback(function(a){if(p.current=a,p.current){var b=document.createRange(),c=window.getSelection();b.selectNodeContents(p.current),b.collapse(!1),c.removeAllRanges(),c.addRange(b),q.current=p.current.innerText}},[])'
    const out = patchFilerobotTextEditorFocusSource(src)
    expect(out).toContain('p.current.focus()')
    expect(patchFilerobotTextEditorFocusSource(out)).toBe(out)
  })
})
