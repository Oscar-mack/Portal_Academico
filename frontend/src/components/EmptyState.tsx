import type { ReactNode } from "react"

export default function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="px-6 py-16 text-center">
      <div className="mx-auto grid size-12 place-items-center rounded-full bg-canvas text-xl text-muted">
        –
      </div>
      <p className="mt-4 text-sm font-bold text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted">{description}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  )
}
