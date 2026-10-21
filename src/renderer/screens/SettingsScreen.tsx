import { useEffect, useRef, useState } from 'react'
import { FileSearch, FolderOpen, X } from 'lucide-react'
import type { LocalUpdateCheck } from '@shared/local-update'
import type { AppSettings } from '@shared/schemas/settings'
import type { TrainingConfig } from '@shared/schemas/training-config'
import type { LtComfyNodesStatus } from '@shared/comfy-install'
import { inferComfyRootFromLorasFolder } from '@shared/comfy-install'
import { ComfyModelSelect } from '../components/ComfyModelSelect'
import { ConfigForm } from '../components/ConfigForm'
import { TrainingModelFields } from '../components/TrainingModelFields'
import { ReleaseNotesModal } from '../components/ReleaseNotesModal'
import { useConfirm } from '../components/useConfirm'
import { unwrap, useAppStore } from '../store'
import { invalidateWildcardKeysCache } from '../components/prompt/useWildcardKeys'

const AUTOSAVE_MS = 400

export function SettingsScreen(): React.JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const refreshAll = useAppStore((s) => s.refreshAll)
  const setStatus = useAppStore((s) => s.setStatus)
  const setError = useAppStore((s) => s.setError)
  const { ask, dialog: confirmDialog } = useConfirm()
  const [local, setLocal] = useState<AppSettings | null>(settings)
  const [tab, setTab] = useState<'tools' | 'config'>('tools')
  const aiToolkitConfigured = Boolean(local?.tools.aiToolkit.workingDirectory.trim())
  const [testMsg, setTestMsg] = useState('')
  const [ioBusy, setIoBusy] = useState(false)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<LocalUpdateCheck | null>(null)
  const [updateChecked, setUpdateChecked] = useState(false)
  const [notesVersion, setNotesVersion] = useState<string | null>(null)
  const [ltNodesStatus, setLtNodesStatus] = useState<LtComfyNodesStatus | null>(null)
  const [ltInstallBusy, setLtInstallBusy] = useState(false)
  const localRef = useRef(local)
  localRef.current = local
  const lastSavedJson = useRef('')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveGen = useRef(0)

  useEffect(() => {
    if (!settings) return
    setLocal((prev) => {
      if (prev == null) {
        lastSavedJson.current = JSON.stringify(settings)
        return settings
      }
      const dirty = JSON.stringify(prev) !== lastSavedJson.current
      if (dirty) return prev
      lastSavedJson.current = JSON.stringify(settings)
      return settings
    })
  }, [settings])

  useEffect(() => {
    if (!aiToolkitConfigured && tab === 'config') setTab('tools')
  }, [aiToolkitConfigured, tab])

  useEffect(() => {
    if (!local) return
    let cancelled = false
    void (async () => {
      try {
        const root = local.comfy.comfyRoot?.trim() || undefined
        const status = unwrap(
          await window.loraTraining.comfy.getLtNodesStatus(root)
        ) as LtComfyNodesStatus
        if (!cancelled) setLtNodesStatus(status)
      } catch {
        if (!cancelled) setLtNodesStatus(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [local?.comfy.comfyRoot, local?.comfy.lorasFolder])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { version } = unwrap(await window.loraTraining.system.getVersion()) as {
          version: string
        }
        if (cancelled) return
        setUpdateInfo((prev) =>
          prev ?? {
            currentVersion: version,
            latestVersion: null,
            installerFileName: null,
            installerPath: null,
            downloadUrl: null,
            source: 'github',
            updateAvailable: false,
            message: ''
          }
        )
      } catch {
        /* ignore — Check for update still works */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function flushSave(override?: AppSettings): Promise<boolean> {
    const cur = override ?? localRef.current
    if (!cur) return true
    const snap = JSON.stringify(cur)
    if (snap === lastSavedJson.current) return true

    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }

    const gen = ++saveGen.current
    const prevRoot = useAppStore.getState().settings?.libraryRoot
    try {
      // Settings UI does not edit last-used tool prefs — omit them so a stale
      // local snapshot cannot wipe e.g. lastStressModels after Stress Apply.
      const {
        lastStressModels: _lsm,
        lastValidationPrompt: _lvp,
        lastWeightRange: _lwr,
        lastUpscaleConfig: _luc,
        lastDiversifyContextConfig: _ldc,
        lastDiversifyExpressionConfig: _lde,
        lastImageScraperSource: _lis,
        imageVersionsAdsMigratedAt: _mig,
        recentDatasetIds: _rd,
        recentJobIds: _rj,
        ...editable
      } = cur
      const next = {
        ...editable,
        queue: {
          allowConcurrentCaptioning: cur.queue?.allowConcurrentCaptioning ?? false,
          continueOnFailure: cur.queue?.continueOnFailure ?? true
        }
      }
      const saved = unwrap(await window.loraTraining.settings.set(next)) as AppSettings
      if (gen !== saveGen.current) return false
      lastSavedJson.current = JSON.stringify(saved)
      localRef.current = saved
      setLocal(saved)
      useAppStore.setState({ settings: saved })
      invalidateWildcardKeysCache()
      if (saved.libraryRoot !== prevRoot) await refreshAll()
      setStatus('Settings saved')
      return true
    } catch (err) {
      if (gen === saveGen.current) {
        setError(err instanceof Error ? err.message : String(err))
      }
      return false
    }
  }

  useEffect(() => {
    if (!local) return
    if (JSON.stringify(local) === lastSavedJson.current) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      void flushSave()
    }, AUTOSAVE_MS)
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
      }
    }
  }, [local])

  // Flush pending edits when leaving Settings.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
      }
      const cur = localRef.current
      if (!cur) return
      if (JSON.stringify(cur) === lastSavedJson.current) return
      const {
        lastStressModels: _lsm,
        lastValidationPrompt: _lvp,
        lastWeightRange: _lwr,
        lastUpscaleConfig: _luc,
        lastDiversifyContextConfig: _ldc,
        lastDiversifyExpressionConfig: _lde,
        lastImageScraperSource: _lis,
        imageVersionsAdsMigratedAt: _mig,
        recentDatasetIds: _rd,
        recentJobIds: _rj,
        ...editable
      } = cur
      void window.loraTraining.settings.set({
        ...editable,
        queue: {
          allowConcurrentCaptioning: cur.queue?.allowConcurrentCaptioning ?? false,
          continueOnFailure: cur.queue?.continueOnFailure ?? true
        }
      })
    }
  }, [])

  if (!local) return <div className="screen empty">Loading settings…</div>

  function forgetUpdateCheck(): void {
    setUpdateChecked(false)
    setNotesVersion(null)
    setUpdateInfo((prev) =>
      prev
        ? {
            ...prev,
            latestVersion: null,
            installerPath: null,
            installerFileName: null,
            downloadUrl: null,
            updateAvailable: false,
            message: ''
          }
        : prev
    )
  }

  const releaseFolder = (local.updateCheckFolder ?? '').trim()
  const installedLabel = (() => {
    const current = updateInfo?.currentVersion ? `v${updateInfo.currentVersion}` : ''
    if (!updateChecked || !updateInfo) {
      const target = releaseFolder
        ? 'Check to compare with folder'
        : 'Check to compare with GitHub Releases'
      return current ? `${current} · ${target}` : target
    }
    if (updateInfo.latestVersion) {
      const where = updateInfo.source === 'github' ? 'GitHub' : 'folder'
      return `${current} · ${where} newest v${updateInfo.latestVersion}`
    }
    return current || updateInfo.message
  })()
  const notesReady = updateChecked && updateInfo?.updateAvailable && Boolean(updateInfo.latestVersion)

  async function pickFolder(
    field:
      | 'libraryRoot'
      | 'joyWd'
      | 'aiWd'
      | 'comfyLoras'
      | 'comfyWildcards'
      | 'comfyRoot'
      | 'updateCheckFolder'
  ): Promise<void> {
    const { path } = unwrap(await window.loraTraining.system.chooseFolder()) as {
      path: string | null
    }
    if (!path) return
    let next: AppSettings
    if (field === 'libraryRoot') {
      next = { ...local!, libraryRoot: path }
    } else if (field === 'updateCheckFolder') {
      next = { ...local!, updateCheckFolder: path }
      forgetUpdateCheck()
    } else if (field === 'joyWd') {
      next = {
        ...local!,
        tools: {
          ...local!.tools,
          joyCaption: { ...local!.tools.joyCaption, workingDirectory: path }
        }
      }
    } else if (field === 'aiWd') {
      next = {
        ...local!,
        tools: {
          ...local!.tools,
          aiToolkit: { ...local!.tools.aiToolkit, workingDirectory: path }
        }
      }
    } else if (field === 'comfyWildcards') {
      next = {
        ...local!,
        comfy: { ...local!.comfy, wildcardLibraryFolder: path }
      }
    } else if (field === 'comfyRoot') {
      next = {
        ...local!,
        comfy: { ...local!.comfy, comfyRoot: path }
      }
    } else {
      const inferred = inferComfyRootFromLorasFolder(path)
      next = {
        ...local!,
        comfy: {
          ...local!.comfy,
          lorasFolder: path,
          comfyRoot: local!.comfy.comfyRoot?.trim()
            ? local!.comfy.comfyRoot
            : inferred ?? local!.comfy.comfyRoot
        }
      }
    }
    setLocal(next)
    await flushSave(next)
  }

  async function pickFile(
    which: 'joyPython' | 'joyScript' | 'aiPython' | 'aiRun' | 'checkpoint'
  ): Promise<void> {
    const { path } = unwrap(
      await window.loraTraining.system.chooseFile(
        which === 'checkpoint'
          ? [
              { name: 'Checkpoints', extensions: ['safetensors', 'ckpt', 'pt', 'bin'] },
              { name: 'All files', extensions: ['*'] }
            ]
          : [{ name: 'Executable / script', extensions: ['exe', 'py', '*'] }]
      )
    ) as { path: string | null }
    if (!path || !local) return
    let next: AppSettings
    if (which === 'checkpoint') {
      next = {
        ...local,
        defaultTrainingConfig: {
          ...local.defaultTrainingConfig,
          model: { ...local.defaultTrainingConfig.model, name_or_path: path }
        }
      }
    } else if (which === 'joyPython') {
      next = {
        ...local,
        tools: {
          ...local.tools,
          joyCaption: { ...local.tools.joyCaption, pythonExecutable: path }
        }
      }
    } else if (which === 'joyScript') {
      next = {
        ...local,
        tools: {
          ...local.tools,
          joyCaption: { ...local.tools.joyCaption, scriptPath: path }
        }
      }
    } else if (which === 'aiPython') {
      next = {
        ...local,
        tools: {
          ...local.tools,
          aiToolkit: { ...local.tools.aiToolkit, pythonExecutable: path }
        }
      }
    } else {
      next = {
        ...local,
        tools: {
          ...local.tools,
          aiToolkit: { ...local.tools.aiToolkit, runScript: path }
        }
      }
    }
    setLocal(next)
    await flushSave(next)
  }

  async function pickComfyLaunch(): Promise<void> {
    const { path } = unwrap(
      await window.loraTraining.system.chooseFile([
        { name: 'ComfyUI launcher', extensions: ['bat', 'cmd', 'exe'] },
        { name: 'All files', extensions: ['*'] }
      ])
    ) as { path: string | null }
    if (!path || !local) return
    const next = {
      ...local,
      comfy: { ...local.comfy, launchCommand: path }
    }
    setLocal(next)
    await flushSave(next)
  }

  async function checkForUpdate(): Promise<void> {
    if (!local) return
    setUpdateBusy(true)
    setTestMsg('')
    try {
      const ok = await flushSave()
      if (!ok) return
      const info = unwrap(await window.loraTraining.system.checkForUpdate()) as LocalUpdateCheck
      setUpdateInfo(info)
      setUpdateChecked(true)
      setTestMsg(info.message)
      setStatus(info.updateAvailable ? `Update available: v${info.latestVersion}` : info.message)
    } catch (err) {
      setUpdateChecked(false)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUpdateBusy(false)
    }
  }

  async function installUpdate(): Promise<void> {
    if (!local) return
    setUpdateBusy(true)
    try {
      const ok = await flushSave()
      if (!ok) return
      setStatus(
        (local.updateCheckFolder ?? '').trim()
          ? 'Launching installer… app will close'
          : 'Downloading installer from GitHub… the app will close when it starts'
      )
      unwrap(
        await window.loraTraining.system.installUpdate(updateInfo?.installerPath ?? undefined)
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setUpdateBusy(false)
    }
  }

  async function exportSettings(): Promise<void> {
    if (ioBusy) return
    setIoBusy(true)
    try {
      const ok = await flushSave()
      if (!ok) return
      const result = unwrap(
        await window.loraTraining.settings.export()
      ) as { cancelled: boolean; path: string | null }
      if (result.cancelled) return
      setStatus(result.path ? `Settings exported · ${result.path}` : 'Settings exported')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIoBusy(false)
    }
  }

  async function importSettings(): Promise<void> {
    if (ioBusy) return
    const confirmed = await ask({
      title: 'Import settings?',
      message:
        'Replace current Settings page values (library root, tools, Comfy, queue prefs, default training config, release folder)? Last-used tool prefs and datasets are not changed. Absolute paths may need fixing on another machine.',
      confirmLabel: 'Import'
    })
    if (!confirmed) return
    setIoBusy(true)
    try {
      await flushSave()
      const prevRoot = useAppStore.getState().settings?.libraryRoot
      const result = unwrap(await window.loraTraining.settings.import()) as {
        cancelled: boolean
        path: string | null
        settings: AppSettings | null
      }
      if (result.cancelled || !result.settings) return
      const saved = result.settings
      lastSavedJson.current = JSON.stringify(saved)
      localRef.current = saved
      setLocal(saved)
      useAppStore.setState({ settings: saved })
      invalidateWildcardKeysCache()
      if (saved.libraryRoot !== prevRoot) await refreshAll()
      setStatus(
        result.path
          ? `Settings imported · ${result.path}`
          : 'Settings imported'
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIoBusy(false)
    }
  }

  return (
    <div className="screen">
      {confirmDialog}
      {notesVersion ? (
        <ReleaseNotesModal version={notesVersion} onClose={() => setNotesVersion(null)} />
      ) : null}
      <div className="toolbar">
        <button
          type="button"
          className={tab === 'tools' ? 'primary' : ''}
          onClick={() => setTab('tools')}
        >
          External tools
        </button>
        {aiToolkitConfigured ? (
          <button
            type="button"
            className={tab === 'config' ? 'primary' : ''}
            onClick={() => setTab('config')}
          >
            Default training config
          </button>
        ) : null}
      </div>

      {tab === 'tools' && (
        <div className="settings-tools">
          <div className="panel">
            <h2 className="section-title">Library</h2>
            <p className="hint" style={{ marginTop: 0 }}>
              Root folder with <code>categories.json</code> and category/dataset folders. Jobs live
              in a hidden <code>!Jobs</code> folder here. Tool paths and Comfy prefs live in{' '}
              <code>settings.json</code> under this library (not AppData).
            </p>
            <div className="form-grid form-rows settings-form">
              <label className="field-row" title="Absolute path to the training library root">
                <span className="field-label">Library root</span>
                <input
                  className="mono"
                  value={local.libraryRoot}
                  onChange={(e) => setLocal({ ...local, libraryRoot: e.target.value })}
                  placeholder="e.g. F:\migration"
                />
                <button
                  type="button"
                  className="icon-btn path-browse-btn"
                  title="Browse for library root"
                  aria-label="Browse for library root"
                  onClick={() => void pickFolder('libraryRoot')}
                >
                  <FolderOpen size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              </label>
              <div
                className="form-row check-row"
                title="Keep up to four image edit versions in NTFS alternate data streams."
              >
                <label className="check">
                  <input
                    type="checkbox"
                    checked={local.imageVersionsEnabled}
                    onChange={(e) =>
                      setLocal({ ...local, imageVersionsEnabled: e.target.checked })
                    }
                  />
                  <span>NTFS versions</span>
                </label>
              </div>
            </div>
            <p className="hint">
              Optional advanced image history; off by default. When off, Edit image and Upscale
              overwrite the image on save like a conventional editor. When on, datasets hosted on
              NTFS drives keep the pristine image plus up to four Undo/Revert versions. Other file
              systems still overwrite.
            </p>
            <div className="toolbar" style={{ marginTop: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <button type="button" disabled={ioBusy} onClick={() => void exportSettings()}>
                Export settings…
              </button>
              <button type="button" disabled={ioBusy} onClick={() => void importSettings()}>
                Import settings…
              </button>
            </div>
            <p className="hint" style={{ marginBottom: 0 }}>
              Settings-page config only (library root, tools, Comfy, queue, default training,
              release folder). A full library backup already includes the same{' '}
              <code>settings.json</code>. Does not export datasets, jobs, or Comfy workflows.
            </p>
          </div>

          <div className="panel">
            <h2 className="section-title">App updates</h2>
            <p className="hint" style={{ marginTop: 0 }}>
              Leave <strong>Release folder</strong> empty to check GitHub Releases and
              download the installer from there. A folder overrides that and uses the{' '}
              <code>LoraTraining Setup X.Y.Z.exe</code> files already in it. <strong>What's new</strong>{' '}
              opens the release notes for a newer version. Install closes the app and runs the
              installer (tick <strong>Run</strong> at the end).
            </p>
            <div className="form-grid form-rows settings-form">
              <label
                className="field-row"
                title="Optional. Empty checks GitHub Releases. A folder uses the Setup exes already in it."
              >
                <span className="field-label">Release folder</span>
                <input
                  className="mono"
                  value={local.updateCheckFolder ?? ''}
                  onChange={(e) => {
                    forgetUpdateCheck()
                    setLocal({ ...local, updateCheckFolder: e.target.value })
                  }}
                  placeholder="Empty = GitHub Releases"
                />
                <button
                  type="button"
                  className="icon-btn path-browse-btn"
                  title="Browse for release folder"
                  aria-label="Browse for release folder"
                  onClick={() => void pickFolder('updateCheckFolder')}
                >
                  <FolderOpen size={14} strokeWidth={2} aria-hidden="true" />
                </button>
                {releaseFolder ? (
                  <button
                    type="button"
                    className="icon-btn path-browse-btn"
                    title="Clear folder and use GitHub Releases"
                    aria-label="Clear release folder"
                    onClick={() => {
                      forgetUpdateCheck()
                      setLocal({ ...local, updateCheckFolder: '' })
                    }}
                  >
                    <X size={14} strokeWidth={2} aria-hidden="true" />
                  </button>
                ) : null}
              </label>
              <div className="field-row" style={{ alignItems: 'center' }}>
                <span className="field-label">Installed</span>
                <span className="mono" style={{ flex: 1 }}>
                  {installedLabel}
                </span>
              </div>
              <div className="toolbar" style={{ marginTop: '0.25rem' }}>
                <button
                  type="button"
                  disabled={updateBusy}
                  title={
                    releaseFolder
                      ? 'Scan the release folder for a newer Setup exe'
                      : 'Check GitHub Releases for a newer Setup exe'
                  }
                  onClick={() => void checkForUpdate()}
                >
                  {updateBusy ? 'Checking…' : 'Check for update'}
                </button>
                <button
                  type="button"
                  disabled={updateBusy || !notesReady}
                  title={
                    notesReady
                      ? `Release notes for v${updateInfo?.latestVersion}`
                      : 'Check for update first — shown when a newer version is found'
                  }
                  onClick={() => {
                    if (updateInfo?.latestVersion) setNotesVersion(updateInfo.latestVersion)
                  }}
                >
                  What's new
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={updateBusy || !updateInfo?.updateAvailable}
                  title={
                    updateInfo?.updateAvailable
                      ? updateInfo.downloadUrl
                        ? `Download ${updateInfo.installerFileName} from GitHub, then quit and run it`
                        : `Quit and run ${updateInfo.installerFileName}`
                      : 'Check for update first — only enabled when a newer installer is found'
                  }
                  onClick={() => void installUpdate()}
                >
                  Install update
                </button>
              </div>
            </div>
          </div>

          <div className="panel">
            <h2 className="section-title">JoyCaption</h2>
            <p className="hint" style={{ marginTop: 0 }}>
              Point <strong>Work dir</strong> at a CUDA Python venv that has{' '}
              <span className="mono">torch</span> / <span className="mono">transformers</span> /{' '}
              <span className="mono">bitsandbytes</span>. The captioner script{' '}
              <span className="mono">kohya_joycaption_captioner_v5_3.py</span> is{' '}
              <strong>shipped with LoraTraining</strong> and loads{' '}
              <span className="mono">fancyfeast/llama-joycaption-beta-one-hf-llava</span> from
              Hugging Face — no JoyCaption GitHub install required. Leave Script at the default
              (a same-named file in Work dir overrides it).
            </p>
            <div className="form-grid form-rows settings-form">
              <label
                className="field-row"
                title="Caption venv root (folder with venv\Scripts\python.exe). Relative scripts resolve here first."
              >
                <span className="field-label">Work dir</span>
                <input
                  className="mono"
                  value={local.tools.joyCaption.workingDirectory}
                  onChange={(e) =>
                    setLocal({
                      ...local,
                      tools: {
                        ...local.tools,
                        joyCaption: {
                          ...local.tools.joyCaption,
                          workingDirectory: e.target.value
                        }
                      }
                    })
                  }
                />
                <button
                  type="button"
                  className="icon-btn path-browse-btn"
                  title="Browse for working directory"
                  aria-label="Browse for working directory"
                  onClick={() => void pickFolder('joyWd')}
                >
                  <FolderOpen size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              </label>
              <label
                className="field-row"
                title="Optional. Leave blank to use venv Scripts\python.exe or Python on PATH."
              >
                <span className="field-label">Python</span>
                <input
                  className="mono"
                  placeholder="venv / PATH"
                  value={local.tools.joyCaption.pythonExecutable}
                  onChange={(e) =>
                    setLocal({
                      ...local,
                      tools: {
                        ...local.tools,
                        joyCaption: {
                          ...local.tools.joyCaption,
                          pythonExecutable: e.target.value
                        }
                      }
                    })
                  }
                />
                <button
                  type="button"
                  className="icon-btn path-browse-btn"
                  title="Browse for Python executable"
                  aria-label="Browse for Python executable"
                  onClick={() => void pickFile('joyPython')}
                >
                  <FileSearch size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              </label>
              <label
                className="field-row"
                title="Defaults to the bundled captioner. Bare filename: Work dir copy wins if present, else resources/joycaption/."
              >
                <span className="field-label">Script</span>
                <input
                  className="mono"
                  placeholder="kohya_joycaption_captioner_v5_3.py"
                  value={local.tools.joyCaption.scriptPath}
                  onChange={(e) =>
                    setLocal({
                      ...local,
                      tools: {
                        ...local.tools,
                        joyCaption: {
                          ...local.tools.joyCaption,
                          scriptPath: e.target.value
                        }
                      }
                    })
                  }
                />
                <button
                  type="button"
                  className="icon-btn path-browse-btn"
                  title="Browse for captioner script"
                  aria-label="Browse for JoyCaption script"
                  onClick={() => void pickFile('joyScript')}
                >
                  <FileSearch size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              </label>
              <label
                className="field-row"
                title="direct = python.exe + args; cmd = activate.bat fallback"
              >
                <span className="field-label">Mode</span>
                <select
                  value={local.tools.joyCaption.invocationMode}
                  onChange={(e) =>
                    setLocal({
                      ...local,
                      tools: {
                        ...local.tools,
                        joyCaption: {
                          ...local.tools.joyCaption,
                          invocationMode: e.target.value as 'direct' | 'cmd'
                        }
                      }
                    })
                  }
                >
                  <option value="direct">direct</option>
                  <option value="cmd">cmd</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    await flushSave()
                    const r = unwrap(await window.loraTraining.tools.testJoyCaption()) as {
                      ok: boolean
                      message: string
                    }
                    setTestMsg(`JoyCaption: ${r.ok ? 'OK' : 'FAIL'} — ${r.message}`)
                  })()
                }}
              >
                Test JoyCaption
              </button>
            </div>
          </div>

          <div className="panel">
            <h2 className="section-title">AI Toolkit</h2>
            <div className="form-grid form-rows settings-form">
              <label className="field-row" title="AI Toolkit repository root (process cwd).">
                <span className="field-label">Work dir</span>
                <input
                  className="mono"
                  value={local.tools.aiToolkit.workingDirectory}
                  onChange={(e) =>
                    setLocal({
                      ...local,
                      tools: {
                        ...local.tools,
                        aiToolkit: {
                          ...local.tools.aiToolkit,
                          workingDirectory: e.target.value
                        }
                      }
                    })
                  }
                />
                <button
                  type="button"
                  className="icon-btn path-browse-btn"
                  title="Browse for working directory"
                  aria-label="Browse for working directory"
                  onClick={() => void pickFolder('aiWd')}
                >
                  <FolderOpen size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              </label>
              <label
                className="field-row"
                title="Optional. Leave blank to use venv Scripts\python.exe or Python on PATH."
              >
                <span className="field-label">Python</span>
                <input
                  className="mono"
                  placeholder="venv / PATH"
                  value={local.tools.aiToolkit.pythonExecutable}
                  onChange={(e) =>
                    setLocal({
                      ...local,
                      tools: {
                        ...local.tools,
                        aiToolkit: {
                          ...local.tools.aiToolkit,
                          pythonExecutable: e.target.value
                        }
                      }
                    })
                  }
                />
                <button
                  type="button"
                  className="icon-btn path-browse-btn"
                  title="Browse for Python executable"
                  aria-label="Browse for Python executable"
                  onClick={() => void pickFile('aiPython')}
                >
                  <FileSearch size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              </label>
              <label
                className="field-row"
                title="Filename relative to working directory (default run.py), or absolute path."
              >
                <span className="field-label">Script</span>
                <input
                  className="mono"
                  placeholder="run.py"
                  value={local.tools.aiToolkit.runScript}
                  onChange={(e) =>
                    setLocal({
                      ...local,
                      tools: {
                        ...local.tools,
                        aiToolkit: {
                          ...local.tools.aiToolkit,
                          runScript: e.target.value
                        }
                      }
                    })
                  }
                />
                <button
                  type="button"
                  className="icon-btn path-browse-btn"
                  title="Browse for run script"
                  aria-label="Browse for run script"
                  onClick={() => void pickFile('aiRun')}
                >
                  <FileSearch size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              </label>
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    await flushSave()
                    const r = unwrap(await window.loraTraining.tools.testAiToolkit()) as {
                      ok: boolean
                      message: string
                    }
                    setTestMsg(`AI Toolkit: ${r.ok ? 'OK' : 'FAIL'} — ${r.message}`)
                  })()
                }}
              >
                Test AI Toolkit
              </button>
            </div>
          </div>

          <div className="panel">
            <h2 className="section-title">Training model</h2>
            <p className="hint" style={{ marginTop: 0 }}>
              <strong>Krea 2 only.</strong> Set your Krea 2 RAW checkpoint path and arch variant.
              These values are stamped onto every job YAML at run time.
            </p>
            <TrainingModelFields
              value={local.defaultTrainingConfig.model}
              onChange={(model) =>
                setLocal({
                  ...local,
                  defaultTrainingConfig: { ...local.defaultTrainingConfig, model }
                })
              }
              onBrowseCheckpoint={() => void pickFile('checkpoint')}
            />
          </div>

          <div className="panel">
            <h2 className="section-title">ComfyUI</h2>
            <p className="hint" style={{ marginTop: 0 }}>
              LoraTraining does <strong>not</strong> package ComfyUI, extra custom-node packs, or
              model weights. <strong>Install LT Comfy package</strong> copies the bundled{' '}
              <strong>LT ·</strong> inject nodes into ComfyUI and seeds the shipped{' '}
              <strong>working Krea 2 workflows</strong> into your library when those files are
              missing (never overwrites graphs you already saved). Install any red/missing nodes
              with <strong>ComfyUI Manager</strong>, put required weights in{' '}
              <span className="mono">ComfyUI/models/…</span> (see docs), restart ComfyUI, then use
              each preview tab.
            </p>
            <div className="form-grid form-rows settings-form">
              <label className="field-row" title="Usually 127.0.0.1 (localhost).">
                <span className="field-label">Host</span>
                <input
                  className="mono"
                  value={local.comfy.host}
                  onChange={(e) =>
                    setLocal({
                      ...local,
                      comfy: { ...local.comfy, host: e.target.value }
                    })
                  }
                />
              </label>
              <label className="field-row" title="Default ComfyUI port is 8188.">
                <span className="field-label">Port</span>
                <input
                  type="number"
                  value={local.comfy.port}
                  onChange={(e) =>
                    setLocal({
                      ...local,
                      comfy: {
                        ...local.comfy,
                        port: Number(e.target.value) || 8188
                      }
                    })
                  }
                />
              </label>
              <label
                className="field-row"
                title="ComfyUI install folder (contains custom_nodes/). Used to copy bundled LT nodes."
              >
                <span className="field-label">Comfy root</span>
                <input
                  className="mono"
                  value={local.comfy.comfyRoot ?? ''}
                  onChange={(e) =>
                    setLocal({
                      ...local,
                      comfy: { ...local.comfy, comfyRoot: e.target.value }
                    })
                  }
                  placeholder="F:\AI\ComfyUI"
                />
                <button
                  type="button"
                  className="icon-btn path-browse-btn"
                  title="Browse for ComfyUI root folder"
                  aria-label="Browse for ComfyUI root folder"
                  onClick={() => void pickFolder('comfyRoot')}
                >
                  <FolderOpen size={14} strokeWidth={2} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-btn path-browse-btn"
                  title="Infer from LoRAs path (…/models/loras → parent)"
                  aria-label="Infer ComfyUI root from LoRAs path"
                  disabled={!inferComfyRootFromLorasFolder(local.comfy.lorasFolder ?? '')}
                  onClick={() => {
                    const inferred = inferComfyRootFromLorasFolder(local.comfy.lorasFolder ?? '')
                    if (!inferred) return
                    setLocal({
                      ...local,
                      comfy: { ...local.comfy, comfyRoot: inferred }
                    })
                  }}
                >
                  ↶
                </button>
              </label>
              <label
                className="field-row"
                title="ComfyUI models/loras root. Required for staged LoRA delete/Move."
              >
                <span className="field-label">LoRAs</span>
                <input
                  className="mono"
                  value={local.comfy.lorasFolder}
                  onChange={(e) =>
                    setLocal({
                      ...local,
                      comfy: { ...local.comfy, lorasFolder: e.target.value }
                    })
                  }
                  placeholder="…/models/loras"
                />
                <button
                  type="button"
                  className="icon-btn path-browse-btn"
                  title="Browse for ComfyUI LoRA folder"
                  aria-label="Browse for ComfyUI LoRA folder"
                  onClick={() => void pickFolder('comfyLoras')}
                >
                  <FolderOpen size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              </label>
              <label
                className="field-row"
                title="Dynamic Prompts wildcards library folder — powers __wildcard__ autocomplete in Validate, Stress, and Upscale prompts."
              >
                <span className="field-label">Wildcards</span>
                <input
                  className="mono"
                  value={local.comfy.wildcardLibraryFolder ?? ''}
                  onChange={(e) =>
                    setLocal({
                      ...local,
                      comfy: { ...local.comfy, wildcardLibraryFolder: e.target.value }
                    })
                  }
                  placeholder="…/wildcards"
                />
                <button
                  type="button"
                  className="icon-btn path-browse-btn"
                  title="Browse for wildcards library folder"
                  aria-label="Browse for wildcards library folder"
                  onClick={() => void pickFolder('comfyWildcards')}
                >
                  <FolderOpen size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              </label>
              <label
                className="field-row"
                title="Subfolder under ComfyUI LoRAs where validation checkpoints are staged."
              >
                <span className="field-label">Val. LoRA</span>
                <input
                  className="mono"
                  value={local.comfy.validationLoraSubfolder}
                  onChange={(e) =>
                    setLocal({
                      ...local,
                      comfy: {
                        ...local.comfy,
                        validationLoraSubfolder: e.target.value
                      }
                    })
                  }
                  placeholder="!Testing"
                />
              </label>
              <label
                className="field-row"
                title="Absolute path to ComfyUI’s launcher (.bat / .exe). Used when Validation or Upscale needs Comfy and it is not running — launched externally so it survives an app restart."
              >
                <span className="field-label">Launch</span>
                <input
                  className="mono"
                  value={local.comfy.launchCommand ?? ''}
                  onChange={(e) =>
                    setLocal({
                      ...local,
                      comfy: { ...local.comfy, launchCommand: e.target.value }
                    })
                  }
                  placeholder="F:\AI\ComfyUI_windows_portable\run_nvidia_gpu.bat"
                />
                <button
                  type="button"
                  className="icon-btn path-browse-btn"
                  title="Browse for ComfyUI launcher (.bat / .exe)"
                  aria-label="Browse for ComfyUI launcher"
                  onClick={() => void pickComfyLaunch()}
                >
                  <FileSearch size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              </label>
              <label
                className="field-row"
                title="Checkpoint injected via LT · Model when a dataset’s Model is Default."
              >
                <span className="field-label">Model</span>
                <ComfyModelSelect
                  value={local.comfy.defaultValidationModel}
                  title="Checkpoint injected via LT · Model when a dataset uses Default"
                  onChange={(defaultValidationModel) =>
                    setLocal({
                      ...local,
                      comfy: { ...local.comfy, defaultValidationModel }
                    })
                  }
                />
              </label>
              <div className="field-row" style={{ gridColumn: '1 / -1' }}>
                <div className="hint" style={{ marginBottom: '0.35rem' }}>
                  {ltNodesStatus?.bundleFound ? (
                    <>
                      LT nodes:{' '}
                      {ltNodesStatus.installed ? (
                        <span className="mono">installed at {ltNodesStatus.installPath}</span>
                      ) : (
                        <span>not installed yet</span>
                      )}
                      {!ltNodesStatus.comfyRoot && local.comfy.lorasFolder?.trim() ? (
                        <> · set Comfy root or infer from LoRAs</>
                      ) : null}
                    </>
                  ) : (
                    <>Bundled LT custom nodes were not found in this app install.</>
                  )}
                </div>
                <div className="toolbar" style={{ padding: 0, gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="primary"
                    disabled={ltInstallBusy || !ltNodesStatus?.bundleFound}
                    title="Copy comfyui-lora-training into ComfyUI/custom_nodes and seed starter library workflows (if missing)"
                    onClick={() => {
                      void (async () => {
                        setLtInstallBusy(true)
                        try {
                          await flushSave()
                          const root =
                            local.comfy.comfyRoot?.trim() ||
                            inferComfyRootFromLorasFolder(local.comfy.lorasFolder ?? '') ||
                            undefined
                          const result = unwrap(
                            await window.loraTraining.comfy.installLtPackage({
                              comfyRoot: root,
                              seedWorkflows: true
                            })
                          ) as {
                            installPath: string
                            updated: boolean
                            workflowsSeeded: string[]
                          }
                          const wf =
                            result.workflowsSeeded.length > 0
                              ? ` · seeded ${result.workflowsSeeded.join(', ')}`
                              : ''
                          setTestMsg(
                            `LT package ${result.updated ? 'installed/updated' : 'already current'} at ${result.installPath}${wf}. Restart ComfyUI; install any missing Manager packs and models once.`
                          )
                          setStatus('LT Comfy package installed — restart ComfyUI')
                          const status = unwrap(
                            await window.loraTraining.comfy.getLtNodesStatus(root)
                          ) as LtComfyNodesStatus
                          setLtNodesStatus(status)
                        } catch (err) {
                          setError(err instanceof Error ? err.message : String(err))
                        } finally {
                          setLtInstallBusy(false)
                        }
                      })()
                    }}
                  >
                    {ltInstallBusy ? 'Installing…' : 'Install LT Comfy package'}
                  </button>
                  <button
                    type="button"
                    disabled={ltInstallBusy}
                    title="Copy shipped working comfy-workflow-*.json into your library only when missing (does not overwrite saved graphs)"
                    onClick={() => {
                      void (async () => {
                        setLtInstallBusy(true)
                        try {
                          const result = unwrap(
                            await window.loraTraining.comfy.seedLtWorkflows()
                          ) as { created: string[]; skipped: string[] }
                          setTestMsg(
                            result.created.length > 0
                              ? `Seeded workflows: ${result.created.join(', ')}`
                              : `All library workflows already present (${result.skipped.join(', ')})`
                          )
                        } catch (err) {
                          setError(err instanceof Error ? err.message : String(err))
                        } finally {
                          setLtInstallBusy(false)
                        }
                      })()
                    }}
                  >
                    Seed bundled workflows
                  </button>
                </div>
              </div>
              <div className="toolbar" style={{ padding: 0, gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => {
                    void (async () => {
                      await flushSave()
                      const r = unwrap(await window.loraTraining.comfy.testConnection()) as {
                        ok: boolean
                        message: string
                      }
                      setTestMsg(`ComfyUI: ${r.ok ? 'OK' : 'FAIL'} — ${r.message}`)
                    })()
                  }}
                >
                  Test ComfyUI
                </button>
                <button
                  type="button"
                  disabled={!(local.comfy.launchCommand ?? '').trim()}
                  title={
                    (local.comfy.launchCommand ?? '').trim()
                      ? 'Launch ComfyUI externally (survives app restart)'
                      : 'Set Launch command first'
                  }
                  onClick={() => {
                    void (async () => {
                      await flushSave()
                      try {
                        unwrap(await window.loraTraining.comfy.launch())
                        setTestMsg('ComfyUI launch requested')
                        setStatus('ComfyUI launch requested')
                      } catch (err) {
                        setError(err instanceof Error ? err.message : String(err))
                      }
                    })()
                  }}
                >
                  Launch ComfyUI
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'config' && (
        <div className="panel">
          <p className="hint" style={{ marginTop: 0 }}>
            Checkpoint / Low VRAM / Quantize / layer offloading live under External tools → Training
            model and apply to every job at start.
          </p>
          <ConfigForm
            value={local.defaultTrainingConfig}
            onChange={(defaultTrainingConfig: TrainingConfig) =>
              setLocal({ ...local, defaultTrainingConfig })
            }
          />
        </div>
      )}

      {testMsg && <p className="mono" style={{ marginTop: '1rem' }}>{testMsg}</p>}
    </div>
  )
}
