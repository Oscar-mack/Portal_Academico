export default function LoadingState({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-label="Cargando información" className="space-y-3 p-6">
      {Array.from({ length: rows }).map((_, index) => (
        <div className="h-12 animate-pulse rounded-xl bg-line/45" key={index} />
      ))}
    </div>
  )
}
