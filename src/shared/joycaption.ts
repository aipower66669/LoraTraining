/** How JoyCaption should treat images that already have a `.txt` sidecar. */
export type JoyCaptionExistingMode = 'missing' | 'overwrite' | 'append'

/** Default captioner script shipped under `resources/joycaption/` (not upstream JoyCaption). */
export const BUNDLED_JOYCAPTION_SCRIPT = 'kohya_joycaption_captioner_v5_3.py'

export type JoyCaptionArgOptions = {
  mode: JoyCaptionExistingMode
  extraArgs?: string[]
  /** Absolute path to --context-file (DATASET CONTEXT append). */
  contextFile?: string | null
  /** Dataset trigger word → --trigger-token. */
  triggerToken?: string | null
}

/**
 * Merge a freshly generated caption onto a prior caption (Append mode).
 * Prior is trimmed and forced to end with ". " (a trailing comma becomes a dot),
 * then the new caption is appended: `"old caption" + ". " + "new caption"`.
 */
export function mergeAppendedCaption(prior: string, generated: string): string {
  const p = prior.replace(/^\uFEFF/, '').trim()
  const g = generated.replace(/^\uFEFF/, '').trim()
  if (!p) return g
  if (!g) return p
  let head = p
  if (/,\s*$/.test(head)) {
    head = head.replace(/,\s*$/, '.')
  }
  if (head.endsWith('. ')) {
    /* already sentence-ended */
  } else if (head.endsWith('.')) {
    head = `${head} `
  } else {
    head = `${head}. `
  }
  return head + g
}

/**
 * Build argv after the Python script path.
 * Matches kohya_joycaption_captioner: default skips existing; `--redo` overwrites.
 * Append mode also passes `--redo` so every image is captioned; the runner then
 * merges prior text back in front of the new caption.
 */
export function buildJoyCaptionArgs(
  folderPath: string,
  modeOrOpts: JoyCaptionExistingMode | JoyCaptionArgOptions,
  extraArgsLegacy: string[] = []
): string[] {
  const opts: JoyCaptionArgOptions =
    typeof modeOrOpts === 'string'
      ? { mode: modeOrOpts, extraArgs: extraArgsLegacy }
      : modeOrOpts

  const strip = new Set(['--redo', '--context-file', '--trigger-token', '--trigger-position'])
  const filtered: string[] = []
  const raw = opts.extraArgs ?? []
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i]!
    if (strip.has(a)) {
      // Skip flag and its value when the next token is not another flag.
      if (
        (a === '--context-file' || a === '--trigger-token' || a === '--trigger-position') &&
        i + 1 < raw.length &&
        !raw[i + 1]!.startsWith('-')
      ) {
        i++
      }
      continue
    }
    filtered.push(a)
  }

  const out: string[] = [folderPath, ...filtered]

  const trigger = opts.triggerToken?.trim()
  if (trigger) {
    out.push('--trigger-token', trigger)
  }

  const contextFile = opts.contextFile?.trim()
  if (contextFile) {
    out.push('--context-file', contextFile)
  }

  if (opts.mode === 'overwrite' || opts.mode === 'append') {
    out.push('--redo')
  }
  return out
}
