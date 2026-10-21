import { DEFAULT_COMFY_CONNECTION, type ComfyConnectionSettings } from '@shared/comfy'
import { ComfyWorkflowEditPane } from './ComfyWorkflowEditPane'

export function ValidationWorkflowPane(props: {
  connection: ComfyConnectionSettings
}): React.JSX.Element {
  return (
    <ComfyWorkflowEditPane
      toolKey="validation"
      connection={props.connection ?? DEFAULT_COMFY_CONNECTION}
      toolLabel="Validation"
      hint="Saves only the Validate → Run graph (isolated session). Leave this tab when finished."
      loadProfile={() => window.loraTraining.comfy.getWorkflow()}
      saveProfile={(workflow, uiWorkflow) =>
        window.loraTraining.comfy.saveWorkflow(workflow, uiWorkflow)
      }
    />
  )
}
