import { useCallback, useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router"
import ErrorState from "../components/ErrorState"
import LoadingState from "../components/LoadingState"
import StatusBadge from "../components/StatusBadge"
import {
  financeService,
  PENDING_CHECKOUT_KEY,
} from "../services/financeService"
import type { Pago } from "../types/api"

interface PendingCheckout {
  pagoId: number
  cargoId: number
  sessionId: string
}

function readPendingCheckout(): PendingCheckout | null {
  try {
    const value = sessionStorage.getItem(PENDING_CHECKOUT_KEY)
    if (!value) return null
    const parsed = JSON.parse(value) as Partial<PendingCheckout>
    if (!parsed.pagoId || !parsed.cargoId || !parsed.sessionId) return null
    return parsed as PendingCheckout
  } catch {
    return null
  }
}

const POLL_INTERVAL_MS = 3000
const POLL_MAX_ATTEMPTS = 20

export default function PaymentReturnPage({
  outcome,
}: {
  outcome: "success" | "cancelled"
}) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [payment, setPayment] = useState<Pago | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [polls, setPolls] = useState(0)
  const stored = readPendingCheckout()
  // El identificador viaja en la URL de retorno; sessionStorage solo es respaldo.
  const queryPagoId = Number(searchParams.get("pago_id"))
  const pagoId = Number.isInteger(queryPagoId) && queryPagoId > 0
    ? queryPagoId
    : stored?.pagoId
  const cargoId = stored && stored.pagoId === pagoId ? stored.cargoId : undefined

  const verify = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      setError("")
      try {
        if (outcome === "cancelled" && pagoId) {
          // Libera el cargo; si el pago ya se confirmó, el backend responde 409 y se muestra el estado real.
          await financeService.cancelCheckout(pagoId).catch(() => undefined)
        }
        const rows = await financeService.listPayments({
          ...(cargoId ? { cargoId } : {}),
        })
        const matching = pagoId
          ? rows.find((item) => item.id === pagoId)
          : undefined
        setPayment(matching ?? null)
        if (matching?.estado === "pagado") {
          sessionStorage.removeItem(PENDING_CHECKOUT_KEY)
        }
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "No fue posible verificar el pago.",
        )
      } finally {
        setLoading(false)
      }
    },
    [outcome, pagoId, cargoId],
  )

  useEffect(() => {
    verify()
  }, [verify])

  // El webhook puede tardar unos segundos: se consulta de nuevo mientras el pago siga pendiente.
  useEffect(() => {
    if (outcome !== "success" || loading || error) return
    if (payment && payment.estado !== "pendiente") return
    if (polls >= POLL_MAX_ATTEMPTS) return
    const timer = window.setTimeout(async () => {
      await verify(true)
      setPolls((value) => value + 1)
    }, POLL_INTERVAL_MS)
    return () => window.clearTimeout(timer)
  }, [outcome, loading, error, payment, polls, verify])

  const verified = payment?.estado === "pagado"

  return (
    <main className="grid min-h-screen place-items-center bg-canvas p-5 text-ink">
      <section className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-white shadow-lg">
        <div className="border-b border-line bg-brand px-6 py-6 text-white">
          <p className="text-xs font-bold uppercase tracking-widest text-white/60">
            Portal Académico
          </p>
          <h1 className="mt-2 text-2xl font-bold">
            {outcome === "cancelled"
              ? "Checkout cancelado"
              : "Verificación del pago"}
          </h1>
        </div>
        <div className="p-6">
          {loading ? (
            <LoadingState rows={3} />
          ) : error ? (
            <ErrorState message={error} onRetry={() => verify()} />
          ) : (
            <div className="space-y-5">
              <div
                className={`rounded-xl border p-5 ${
                  verified
                    ? "border-emerald-200 bg-emerald-50"
                    : outcome === "cancelled"
                      ? "border-line bg-canvas/60"
                      : "border-amber-200 bg-amber-50"
                }`}
              >
                <StatusBadge
                  tone={
                    verified
                      ? "success"
                      : outcome === "cancelled"
                        ? "neutral"
                        : "warning"
                  }
                >
                  {verified
                    ? "Confirmado por el backend"
                    : payment?.estado ?? "Pendiente de verificación"}
                </StatusBadge>
                <p className="mt-4 text-lg font-bold">
                  {verified
                    ? "El pago está registrado como pagado."
                    : outcome === "cancelled"
                      ? "No se asume que exista un pago confirmado."
                      : "El retorno de Stripe no confirma el pago."}
                </p>
                <p className="mt-2 text-sm leading-6 text-muted">
                  {verified
                    ? "El estado fue obtenido mediante GET /api/pagos."
                    : "La confirmación definitiva depende del webhook de Stripe. Puedes verificar nuevamente para consultar el estado más reciente."}
                </p>
              </div>
              {payment && (
                <dl className="grid gap-3 rounded-xl border border-line p-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-bold uppercase text-muted">
                      Pago
                    </dt>
                    <dd className="mt-1 text-sm font-bold">ID {payment.id}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold uppercase text-muted">
                      Cargo
                    </dt>
                    <dd className="mt-1 text-sm font-bold">
                      {payment.cargoId ? `ID ${payment.cargoId}` : "Histórico"}
                    </dd>
                  </div>
                </dl>
              )}
              <div className="flex flex-col gap-3 sm:flex-row">
                {!verified && (
                  <button
                    className="flex-1 rounded-xl bg-brand px-4 py-3 text-sm font-bold text-white hover:bg-brand-dark"
                    onClick={() => { setPolls(0); verify() }}
                    type="button"
                  >
                    Verificar nuevamente
                  </button>
                )}
                <button
                  className="flex-1 rounded-xl border border-line px-4 py-3 text-sm font-bold text-muted hover:bg-canvas"
                  onClick={() => navigate("/portal", { replace: true })}
                  type="button"
                >
                  Volver al portal
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
