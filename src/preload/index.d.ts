import type { LoraTrainingApi } from './index'

declare global {
  interface Window {
    loraTraining: LoraTrainingApi
  }
}

export {}
