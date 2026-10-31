import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react"

export function FormField({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-5 text-muted">{hint}</span>}
    </label>
  )
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-11 w-full rounded-xl border border-line bg-white px-3.5 text-sm text-ink outline-none transition placeholder:text-muted/55 focus:border-brand-soft focus:ring-4 focus:ring-brand-soft/10 disabled:bg-canvas disabled:text-muted ${props.className ?? ""}`}
    />
  )
}

export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`h-11 w-full rounded-xl border border-line bg-white px-3.5 text-sm text-ink outline-none transition focus:border-brand-soft focus:ring-4 focus:ring-brand-soft/10 disabled:bg-canvas disabled:text-muted ${props.className ?? ""}`}
    />
  )
}

export function TextAreaInput(
  props: TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  return (
    <textarea
      {...props}
      className={`min-h-28 w-full resize-y rounded-xl border border-line bg-white px-3.5 py-3 text-sm text-ink outline-none transition placeholder:text-muted/55 focus:border-brand-soft focus:ring-4 focus:ring-brand-soft/10 disabled:bg-canvas disabled:text-muted ${props.className ?? ""}`}
    />
  )
}
