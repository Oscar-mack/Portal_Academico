import { ReactNode, useEffect } from "react"

export default function Modal({
  open,
  title,
  description,
  children,
  onClose,
}: {
  open: boolean
  title: string
  description?: string
  children: ReactNode
  onClose: () => void
}) {
  useEffect(() => {
    if (!open) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      aria-labelledby="modal-title"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/45 p-4 backdrop-blur-sm"
      role="dialog"
    >
      <button
        aria-label="Cerrar ventana"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        type="button"
      />
      <div className="relative my-8 w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-5 border-b border-line px-6 py-5">
          <div>
            <h2 className="text-lg font-bold text-ink" id="modal-title">
              {title}
            </h2>
            {description && <p className="mt-1 text-sm leading-6 text-muted">{description}</p>}
          </div>
          <button
            aria-label="Cerrar"
            className="grid size-9 shrink-0 place-items-center rounded-lg bg-canvas text-xl leading-none text-muted transition hover:bg-line/60 hover:text-ink"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
