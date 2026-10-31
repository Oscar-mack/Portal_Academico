import type { ReactNode } from "react"

export default function FilterBar({
  search,
  onSearchChange,
  placeholder = "Buscar...",
  children,
}: {
  search: string
  onSearchChange: (value: string) => void
  placeholder?: string
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-line p-5 sm:flex-row sm:items-center sm:p-6">
      <label className="relative block min-w-0 flex-1">
        <span className="sr-only">Buscar</span>
        <svg
          aria-hidden="true"
          className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          viewBox="0 0 24 24"
        >
          <path d="m21 21-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" />
        </svg>
        <input
          className="h-11 w-full rounded-xl border border-line bg-canvas/40 pr-4 pl-10 text-sm outline-none transition placeholder:text-muted/60 focus:border-brand-soft focus:bg-white focus:ring-4 focus:ring-brand-soft/10"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={placeholder}
          type="search"
          value={search}
        />
      </label>
      {children}
    </div>
  )
}
