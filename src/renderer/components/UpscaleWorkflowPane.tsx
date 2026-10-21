import { DEFAULT_COMFY_CONNECTION, type ComfyConnectionSettings } from '@shared/comfy'
import { ComfyWorkflowEditPane } from './ComfyWorkflowEditPane'

/** Edit Workflow for Upscale — own session + own JSON slot (never shares Validation's). */
export function UpscaleWorkflowPane(props: {
  connection: ComfyConnectionSettings
}): React.JSX.Element {
  return (
    <ComfyWorkflowEditPane
      toolKey="upscale"
      connection={props.connection ?? DEFAULT_COMFY_CONNECTION}
      toolLabel="Upscale"
      hint="Saves only the Upscale → Run graph (isolated session). Leave this tab when finished."
      loadProfile={() => window.loraTraining.upscale.getWorkflow()}
      saveProfile={(workflow, uiWorkflow) =>
        window.loraTraining.upscale.saveWorkflow(workflow, uiWorkflow)
      }
    />
  )
}
