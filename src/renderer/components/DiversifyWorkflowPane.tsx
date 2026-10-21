import type { DiversifyMode } from '@shared/diversify-config'
import { DEFAULT_COMFY_CONNECTION, type ComfyConnectionSettings } from '@shared/comfy'
import { useEffect } from 'react'
import { ComfyWorkflowEditPane } from './ComfyWorkflowEditPane'
import { writeLastDiversifyMode } from '../store/actions'

/** ComfyUI workflow editor for Diversify · Context or Expression. */
export function DiversifyWorkflowPane(props: {
  mode: DiversifyMode
  connection: ComfyConnectionSettings
}): React.JSX.Element {
  const label = props.mode === 'context' ? 'Context' : 'Expression'

  useEffect(() => {
    writeLastDiversifyMode(props.mode)
  }, [props.mode])

  return (
    <ComfyWorkflowEditPane
      toolKey={props.mode}
      connection={props.connection ?? DEFAULT_COMFY_CONNECTION}
      toolLabel={`Diversify · ${label}`}
      hint={
        props.mode === 'expression'
          ? 'Saves only the Expression graph. Required LT nodes: Input Image, Seed, Output Folder, Output Filename (app sends a fresh random seed each run; no Prompt).'
          : 'Saves only the Context graph. Required LT nodes: Input Image, Prompt, Seed, Output Folder, Output Filename.'
      }
      loadProfile={() => window.loraTraining.diversify.getWorkflow(props.mode)}
      saveProfile={(workflow, uiWorkflow) =>
        window.loraTraining.diversify.saveWorkflow(props.mode, workflow, uiWorkflow)
      }
    />
  )
}
