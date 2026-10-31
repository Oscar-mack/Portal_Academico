export const DEFAULT_CURRENCY = "GTQ"

export function money(currency: string | null | undefined, value: number | string) {
  const code = (currency || DEFAULT_CURRENCY).toUpperCase()
  const amount = Number(value)
  return new Intl.NumberFormat("es-GT", {
    style: "currency",
    currency: code,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0)
}
