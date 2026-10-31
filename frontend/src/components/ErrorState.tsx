export default function ErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <div className="flex items-center justify-between gap-4">
        <span>{message}</span>
        {onRetry && (
          <button className="shrink-0 font-bold underline" onClick={onRetry} type="button">
            Reintentar
          </button>
        )}
      </div>
    </div>
  )
}
