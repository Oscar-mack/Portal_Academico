import type { ReactNode } from "react"

export default function AdminPage({
  title,
  description,
  count,
  action,
  children,
}: {
  title: string
  description: string
  count?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-white">
      <div className="flex flex-col justify-between gap-4 border-b border-line p-5 sm:flex-row sm:items-center sm:p-6">
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          <p className="mt-1 text-sm text-muted">{count || description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}
