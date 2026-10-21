import type {
  StressTestProgress,
  ValidationProgress,
  WeightValidationProgress
} from '@shared/comfy'
import { useAppStore } from '../store'
import { unwrap } from '../store'

export type PreviewRunKind = 'validation' | 'weight' | 'stress'

export type ActivePreviewRun = {
  kind: PreviewRunKind
  progress: ValidationProgress | WeightValidationProgress | StressTestProgress
}

/** Whichever Steps / Weight / Stress run is currently generating (shared continuum). */
export function selectActivePreviewRun(state: {
  validationProgress: ValidationProgress | null
  weightProgress: WeightValidationProgress | null
  stressProgress: StressTestProgress | null
}): ActivePreviewRun | null {
  if (state.validationProgress?.status === 'running') {
    return { kind: 'validation', progress: state.validationProgress }
  }
  if (state.weightProgress?.status === 'running') {
    return { kind: 'weight', progress: state.weightProgress }
  }
  if (state.stressProgress?.status === 'running') {
    return { kind: 'stress', progress: state.stressProgress }
  }
  return null
}

/**
 * Subscribe with primitive/ref-stable pieces — never return a fresh object from the
 * Zustand selector (that triggers "Maximum update depth exceeded").
 */
export function useActivePreviewRun(): ActivePreviewRun | null {
  const validationProgress = useAppStore((s) => s.validationProgress)
  const weightProgress = useAppStore((s) => s.weightProgress)
  const stressProgress = useAppStore((s) => s.stressProgress)
  return selectActivePreviewRun({ validationProgress, weightProgress, stressProgress })
}

export async function cancelActivePreviewRun(kind: PreviewRunKind): Promise<void> {
  if (kind === 'validation') {
    unwrap(await window.loraTraining.comfy.cancelValidation())
    return
  }
  if (kind === 'weight') {
    unwrap(await window.loraTraining.comfy.cancelWeightValidation())
    return
  }
  unwrap(await window.loraTraining.comfy.cancelStressTest())
}

export function previewRunKindLabel(kind: PreviewRunKind): string {
  if (kind === 'validation') return 'Validation Steps'
  if (kind === 'weight') return 'Validation Weight'
  return 'Stress Test'
}
