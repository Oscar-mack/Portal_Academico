import type { ReactNode } from "react"

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral"

const toneClasses: Record<StatusTone, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  danger: "border-red-200 bg-red-50 text-red-700",
  info: "border-brand-soft/20 bg-brand-soft/7 text-brand-soft",
  neutral: "border-line bg-canvas text-muted",
}

export default function StatusBadge({
  tone = "neutral",
  children,
}: {
  tone?: StatusTone
  children: ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[0.68rem] font-bold ${toneClasses[tone]}`}
    >
      {children}
    </span>
  )
}
