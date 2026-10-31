import Modal from "./Modal"

export default function ConfirmDialog({
  open,
  title,
  message,
  confirming,
  confirmLabel = "Eliminar registro",
  confirmingLabel = "Eliminando...",
  tone = "danger",
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  message: string
  confirming: boolean
  confirmLabel?: string
  confirmingLabel?: string
  tone?: "danger" | "brand"
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Modal open={open} title={title} onClose={onCancel}>
      <div className="px-6 py-6">
        <div
          className={`rounded-xl border p-4 text-sm leading-6 ${
            tone === "danger"
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-brand-soft/20 bg-brand-soft/5 text-ink"
          }`}
        >
          {message}
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button
            className="rounded-xl border border-line px-4 py-2.5 text-sm font-bold text-muted transition hover:bg-canvas"
            disabled={confirming}
            onClick={onCancel}
            type="button"
          >
            Cancelar
          </button>
          <button
            className={`rounded-xl px-4 py-2.5 text-sm font-bold text-white transition disabled:cursor-wait disabled:opacity-60 ${
              tone === "danger"
                ? "bg-red-600 hover:bg-red-700"
                : "bg-brand hover:bg-brand-dark"
            }`}
            disabled={confirming}
            onClick={onConfirm}
            type="button"
          >
            {confirming ? confirmingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
