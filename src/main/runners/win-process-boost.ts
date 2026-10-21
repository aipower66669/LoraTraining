import { spawn } from 'node:child_process'
import { constants, platform, setPriority } from 'node:os'
import { logger } from '../logging'

/**
 * Windows 11 often EcoQoS / Efficiency-Mode throttles Electron and its children
 * when the window is unfocused — that starves AI Toolkit dataloaders and shows
 * up as slower s/it + quieter GPU fans. Priority class alone is not enough;
 * we also clear PROCESS_POWER_THROTTLING_EXECUTION_SPEED on the process tree.
 */

function applyNodePriority(pid: number, level: number): void {
  try {
    setPriority(pid, level)
  } catch {
    /* best-effort */
  }
}

/** Build a PowerShell -EncodedCommand payload (UTF-16LE). */
function encodedPowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

/**
 * Raise `rootPid` + descendants (and optionally `extraPids`) to High priority and
 * disable EcoQoS execution-speed throttling. Fire-and-forget on Windows.
 */
export function boostWindowsProcessTree(rootPid: number, extraPids: number[] = []): void {
  if (platform() !== 'win32') {
    applyNodePriority(rootPid, constants.priority.PRIORITY_HIGH)
    for (const pid of extraPids) applyNodePriority(pid, constants.priority.PRIORITY_HIGH)
    return
  }

  applyNodePriority(rootPid, constants.priority.PRIORITY_HIGH)
  for (const pid of extraPids) applyNodePriority(pid, constants.priority.PRIORITY_HIGH)

  const roots = [rootPid, ...extraPids.filter((p) => p > 0 && p !== rootPid)]
  const rootsLiteral = roots.join(',')

  // Keep the script ASCII-only so EncodedCommand stays simple.
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$roots = @(${rootsLiteral})
function Get-ProcessTree([int[]]$start) {
  $seen = [System.Collections.Generic.HashSet[int]]::new()
  $q = [System.Collections.Generic.Queue[int]]::new()
  foreach ($id in $start) { if ($id -gt 0) { [void]$seen.Add($id); $q.Enqueue($id) } }
  while ($q.Count -gt 0) {
    $cur = $q.Dequeue()
    Get-CimInstance Win32_Process -Filter "ParentProcessId=$cur" | ForEach-Object {
      $child = [int]$_.ProcessId
      if ($seen.Add($child)) { $q.Enqueue($child) }
    }
  }
  return @($seen)
}
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class LoraPowerThrottle {
  public const int ProcessPowerThrottling = 4;
  public const uint Version = 1;
  public const uint ExecutionSpeed = 0x1;
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern IntPtr OpenProcess(uint a, bool b, int pid);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool SetProcessInformation(IntPtr h, int cls,
    ref PROCESS_POWER_THROTTLING_STATE info, int size);
  [StructLayout(LayoutKind.Sequential)]
  public struct PROCESS_POWER_THROTTLING_STATE {
    public uint Version;
    public uint ControlMask;
    public uint StateMask;
  }
  public static void DisableEcoQos(int pid) {
    // PROCESS_SET_INFORMATION | PROCESS_QUERY_LIMITED_INFORMATION
    IntPtr h = OpenProcess(0x1200, false, pid);
    if (h == IntPtr.Zero) return;
    var s = new PROCESS_POWER_THROTTLING_STATE {
      Version = Version,
      ControlMask = ExecutionSpeed,
      StateMask = 0
    };
    SetProcessInformation(h, ProcessPowerThrottling, ref s, Marshal.SizeOf(s));
    CloseHandle(h);
  }
}
"@
foreach ($procId in (Get-ProcessTree $roots)) {
  try {
    $p = Get-Process -Id $procId
    $p.PriorityClass = 'High'
  } catch {}
  try { [LoraPowerThrottle]::DisableEcoQos([int]$procId) } catch {}
}
`.trim()

  try {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedPowerShell(script)],
      { windowsHide: true, stdio: 'ignore', detached: true }
    )
    child.unref()
  } catch (err) {
    logger.warn({ err, rootPid }, 'windows process-tree boost spawn failed')
  }
}

export function restoreProcessPriority(pid: number): void {
  applyNodePriority(pid, constants.priority.PRIORITY_NORMAL)
}
