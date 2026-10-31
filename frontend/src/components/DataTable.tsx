import type { ReactNode } from "react"

export default function DataTable({
  children,
  minWidth = "min-w-[52rem]",
}: {
  children: ReactNode
  minWidth?: string
}) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full text-left ${minWidth}`}>{children}</table>
    </div>
  )
}
