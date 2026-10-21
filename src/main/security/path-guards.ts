import { isAbsolute, normalize, resolve, sep } from 'node:path'
import { appError } from '@shared/errors'

export function assertInsideRoot(root: string, candidate: string): string {
  const rootResolved = resolve(root)
  const candidateResolved = resolve(rootResolved, candidate)
  const prefix = rootResolved.endsWith(sep) ? rootResolved : rootResolved + sep
  if (candidateResolved !== rootResolved && !candidateResolved.startsWith(prefix)) {
    throw appError('path-escape', `Path escapes dataset folder: ${candidate}`, {
      remediation: 'Only files inside the registered dataset folder can be accessed.'
    })
  }
  return candidateResolved
}

export function assertAbsolutePath(p: string): string {
  if (!isAbsolute(p)) {
    throw appError('validation', `Expected absolute path, got: ${p}`)
  }
  return normalize(p)
}
