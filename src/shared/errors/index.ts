export type AppErrorCode =
  | 'no-dataset'
  | 'no-job'
  | 'path-escape'
  | 'tool-not-configured'
  | 'process-failed'
  | 'invalid-config'
  | 'queue-busy'
  | 'folder-missing'
  | 'validation'
  | 'upscale'
  | 'diversify'
  | 'not-found'
  | 'busy'
  | 'cancelled'
  | 'unknown'

export interface AppError {
  code: AppErrorCode
  message: string
  details?: unknown
  remediation?: string
}

export function appError(
  code: AppErrorCode,
  message: string,
  opts?: { details?: unknown; remediation?: string }
): AppError {
  return {
    code,
    message,
    details: opts?.details,
    remediation: opts?.remediation
  }
}
