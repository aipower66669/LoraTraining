/**
 * Minimal NTFS detection for image-version ADS.
 */
import koffi from 'koffi'
import { logger } from '../logging'

let GetVolumeInformationW:
  | ((
      root: string,
      nameBuf: null,
      nameSize: number,
      serial: null,
      maxComp: null,
      flags: null,
      fsBuf: Buffer,
      fsSize: number
    ) => number)
  | null
  | undefined

function ensureApi(): typeof GetVolumeInformationW {
  if (GetVolumeInformationW !== undefined) return GetVolumeInformationW
  if (process.platform !== 'win32') {
    GetVolumeInformationW = null
    return null
  }
  try {
    const kernel32 = koffi.load('kernel32.dll')
    GetVolumeInformationW = kernel32.func(
      'int32 __stdcall GetVolumeInformationW(str16 lpRootPathName, void *lpVolumeNameBuffer, uint32 nVolumeNameSize, void *lpVolumeSerialNumber, void *lpMaximumComponentLength, void *lpFileSystemFlags, void *lpFileSystemNameBuffer, uint32 nFileSystemNameSize)'
    ) as NonNullable<typeof GetVolumeInformationW>
  } catch (e) {
    logger.warn(
      { err: e },
      'GetVolumeInformationW unavailable — ADS image versions disabled'
    )
    GetVolumeInformationW = null
  }
  return GetVolumeInformationW
}

const ntfsPathCache = new Map<string, boolean>()

function readFileSystemName(rootPath: string): string | null {
  const api = ensureApi()
  if (!api) return null
  const root = rootPath.endsWith('\\') ? rootPath : `${rootPath}\\`
  const fsBuf = Buffer.alloc(64 * 2)
  const ok = api(root, null, 0, null, null, null, fsBuf, 64)
  if (!ok) return null
  const raw = fsBuf.toString('utf16le').replace(/\0.*$/s, '').trim()
  return raw || null
}

/**
 * True when `absPath` is on an NTFS volume (ADS-capable). Non-win32 / unknown → false.
 * Cached per drive root.
 */
export function pathIsNtfs(absPath: string): boolean {
  if (process.platform !== 'win32') return false
  const m = /^([a-zA-Z]:)/.exec(absPath.replace(/\//g, '\\'))
  if (!m) return false
  const root = `${m[1]!.toUpperCase()}\\`
  const cached = ntfsPathCache.get(root)
  if (cached !== undefined) return cached
  const fsName = readFileSystemName(root)
  const ok = (fsName ?? '').toUpperCase() === 'NTFS'
  ntfsPathCache.set(root, ok)
  return ok
}
