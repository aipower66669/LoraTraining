import { jobBreadcrumbParts } from '@shared/dataset-jobs'

/** Category \\ **Dataset** breadcrumb for job lists and headers. */
export function JobBreadcrumb(props: {
  categoryName: string | null | undefined
  datasetName: string
  className?: string
}): React.JSX.Element {
  const { category, dataset } = jobBreadcrumbParts(props.categoryName, props.datasetName)
  return (
    <span className={props.className} title={`${category} \\ ${dataset}`}>
      <span className="job-breadcrumb-cat">{category}</span>
      <span className="job-breadcrumb-sep"> \ </span>
      <strong className="job-breadcrumb-dataset">{dataset}</strong>
    </span>
  )
}
