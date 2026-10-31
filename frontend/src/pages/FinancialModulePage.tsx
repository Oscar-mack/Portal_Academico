import { FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import AdminPage from "../components/AdminPage"
import DataTable from "../components/DataTable"
import EmptyState from "../components/EmptyState"
import ErrorState from "../components/ErrorState"
import FilterBar from "../components/FilterBar"
import {
  FormField,
  SelectInput,
  TextAreaInput,
  TextInput,
} from "../components/FormField"
import LoadingState from "../components/LoadingState"
import Modal from "../components/Modal"
import StatusBadge, { type StatusTone } from "../components/StatusBadge"
import { useAcademicPeriod } from "../context/AcademicPeriodContext"
import type { AuthUser } from "../lib/api"
import { downloadBlob } from "../lib/download"
import { catalogsService } from "../services/catalogsService"
import { familyService } from "../services/familyService"
import {
  financeService,
  PENDING_CHECKOUT_KEY,
  type CargoInput,
} from "../services/financeService"
import type {
  Alumno,
  Cargo,
  CargoState,
  CurrencyCode,
  Pago,
  RequisitoSolvencia,
  Solvencia,
} from "../types/api"
import { FormActions, Notice } from "./admin/GradosCarrerasPage"

const CHARGE_STATES: CargoState[] = [
  "pendiente",
  "parcial",
  "pagado",
  "vencido",
  "anulado",
]

function fullName(person?: { nombre: string; apellido: string }) {
  return person ? `${person.nombre} ${person.apellido}` : "Sin información"
}

function money(currency: string, value: number | string) {
  return new Intl.NumberFormat("es-GT", {
    style: "currency",
    currency,
  }).format(Number(value))
}

function date(value?: string | null) {
  return value
    ? new Intl.DateTimeFormat("es-GT", { dateStyle: "medium" }).format(
        new Date(value),
      )
    : "Sin fecha"
}

function chargeTone(state: CargoState): StatusTone {
  if (state === "pagado") return "success"
  if (state === "anulado") return "neutral"
  if (state === "vencido") return "danger"
  return "warning"
}

function paymentTone(state: Pago["estado"]): StatusTone {
  if (state === "pagado") return "success"
  if (state === "fallido") return "danger"
  if (state === "cancelado") return "neutral"
  return "warning"
}

export default function FinancialModulePage({
  user,
  initialView = "charges",
}: {
  user: AuthUser
  initialView?: "charges" | "payments"
}) {
  const {
    cycles,
    periods,
    selectedPeriodId,
  } = useAcademicPeriod()
  const canManage = user.rol === "admin"
  const canCheckout = user.rol === "alumno" || user.rol === "padre"
  const [view, setView] = useState<"charges" | "payments" | "solvency">(
    initialView,
  )
  const [students, setStudents] = useState<Alumno[]>([])
  const [studentId, setStudentId] = useState("")
  const [charges, setCharges] = useState<Cargo[]>([])
  const [payments, setPayments] = useState<Pago[]>([])
  const [solvency, setSolvency] = useState<Solvencia | null>(null)
  const [requirements, setRequirements] = useState<RequisitoSolvencia[]>([])
  const [query, setQuery] = useState("")
  const [stateFilter, setStateFilter] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [editor, setEditor] = useState<Cargo | "create" | null>(null)
  const [cancelling, setCancelling] = useState<Cargo | null>(null)
  const [checkout, setCheckout] = useState<Cargo | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const effectiveStudentId =
    Number(studentId) || Number(user.alumnoId) || undefined

  useEffect(() => {
    setView(initialView)
  }, [initialView])

  useEffect(() => {
    let active = true
    async function loadStudents() {
      try {
        if (user.rol === "admin") {
          const rows = await catalogsService.listStudents({
            incluirInactivos: true,
          })
          if (active) setStudents(rows)
        } else if (user.rol === "padre") {
          const links = await familyService.getMyStudents()
          if (!active) return
          setStudents(links.map((link) => link.alumno))
          setStudentId(String(links[0]?.alumno.id ?? ""))
        }
      } catch (requestError) {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "No fue posible consultar los estudiantes.",
          )
        }
      }
    }
    loadStudents()
    return () => {
      active = false
    }
  }, [user.rol])

  const load = useCallback(async () => {
    if (user.rol === "padre" && !effectiveStudentId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError("")
    try {
      const filters = effectiveStudentId
        ? { alumnoId: effectiveStudentId }
        : {}
      const [chargeRows, paymentRows, requirementRows] = await Promise.all([
        financeService.listCharges({
          ...filters,
          periodoAcademicoId: selectedPeriodId ?? undefined,
          incluirAnulados: true,
        }),
        financeService.listPayments(filters),
        financeService.listRequirements(),
      ])
      setCharges(chargeRows)
      setPayments(paymentRows)
      setRequirements(requirementRows)
      if (user.rol === "alumno" || effectiveStudentId) {
        setSolvency(await financeService.getSolvency(effectiveStudentId))
      } else {
        setSolvency(null)
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible consultar la información financiera.",
      )
    } finally {
      setLoading(false)
    }
  }, [effectiveStudentId, selectedPeriodId, user.rol])

  useEffect(() => {
    load()
  }, [load])

  const visibleCharges = useMemo(() => {
    const term = query.trim().toLowerCase()
    return charges.filter((charge) => {
      const emitted = charge.fechaEmision.slice(0, 10)
      return (
        (!stateFilter || charge.estado === stateFilter) &&
        (!startDate || emitted >= startDate) &&
        (!endDate || emitted <= endDate) &&
        (!term ||
          charge.concepto.toLowerCase().includes(term) ||
          charge.descripcion?.toLowerCase().includes(term) ||
          fullName(charge.alumno).toLowerCase().includes(term))
      )
    })
  }, [charges, query, stateFilter, startDate, endDate])

  const currencyTotals = useMemo(() => {
    const result = new Map<
      string,
      { original: number; paid: number; pending: number }
    >()
    visibleCharges
      .filter((charge) => charge.estado !== "anulado")
      .forEach((charge) => {
        const current = result.get(charge.moneda) ?? {
          original: 0,
          paid: 0,
          pending: 0,
        }
        current.original += Number(charge.montoOriginal)
        current.paid += Number(charge.montoPagado)
        current.pending += Number(charge.saldoPendiente)
        result.set(charge.moneda, current)
      })
    return [...result.entries()]
  }, [visibleCharges])

  async function submitCharge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const record = editor === "create" ? null : editor
    const amount = Number(form.get("montoOriginal"))
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("El monto original debe ser un número mayor que cero.")
      return
    }
    setSaving(true)
    setError("")
    try {
      if (record) {
        await financeService.updateCharge(record.id, {
          concepto: String(form.get("concepto") ?? "").trim(),
          descripcion:
            String(form.get("descripcion") ?? "").trim() || undefined,
          montoOriginal: amount,
          fechaVencimiento:
            String(form.get("fechaVencimiento") ?? "") || null,
        })
        setNotice("El cargo se actualizó correctamente.")
      } else {
        const cycleValue = Number(form.get("cicloAcademicoId")) || null
        const periodValue = Number(form.get("periodoAcademicoId")) || null
        const input: CargoInput = {
          alumnoId: Number(form.get("alumnoId")),
          concepto: String(form.get("concepto") ?? "").trim(),
          descripcion:
            String(form.get("descripcion") ?? "").trim() || undefined,
          montoOriginal: amount,
          moneda: String(form.get("moneda")) as CurrencyCode,
          fechaEmision:
            String(form.get("fechaEmision") ?? "") || undefined,
          fechaVencimiento:
            String(form.get("fechaVencimiento") ?? "") || null,
          cicloAcademicoId: cycleValue,
          periodoAcademicoId: periodValue,
        }
        await financeService.createCharge(input)
        setNotice("El cargo se registró correctamente.")
      }
      setEditor(null)
      await load()
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible guardar el cargo.",
      )
    } finally {
      setSaving(false)
    }
  }

  async function submitCancellation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!cancelling) return
    const form = new FormData(event.currentTarget)
    const reason = String(form.get("motivo") ?? "").trim()
    if (!reason) {
      setError("Debes indicar el motivo de la anulación.")
      return
    }
    setSaving(true)
    setError("")
    try {
      await financeService.cancelCharge(cancelling.id, reason)
      setNotice("El cargo fue anulado correctamente.")
      setCancelling(null)
      await load()
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible anular el cargo.",
      )
    } finally {
      setSaving(false)
    }
  }

  async function submitCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!checkout) return
    const form = new FormData(event.currentTarget)
    const amount = Number(form.get("monto"))
    const balance = Number(checkout.saldoPendiente)
    if (!Number.isFinite(amount) || amount <= 0 || amount > balance) {
      setError(
        `El monto debe ser mayor que cero y no puede superar ${money(
          checkout.moneda,
          balance,
        )}.`,
      )
      return
    }
    setSaving(true)
    setError("")
    try {
      const response = await financeService.createCheckout({
        cargoId: checkout.id,
        ...(amount < balance ? { monto: amount } : {}),
      })
      sessionStorage.setItem(
        PENDING_CHECKOUT_KEY,
        JSON.stringify({
          pagoId: response.pagoId,
          cargoId: checkout.id,
          sessionId: response.sessionId,
        }),
      )
      window.location.assign(response.url)
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible iniciar Stripe Checkout.",
      )
      setSaving(false)
    }
  }

  async function downloadAccount() {
    if (!effectiveStudentId) return
    setDownloading(true)
    setError("")
    try {
      const blob = await financeService.downloadAccountStatement(
        effectiveStudentId,
        { periodoAcademicoId: selectedPeriodId ?? undefined },
      )
      downloadBlob(blob, `estado-cuenta-alumno-${effectiveStudentId}.pdf`)
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible descargar el estado de cuenta.",
      )
    } finally {
      setDownloading(false)
    }
  }

  const record = editor === "create" ? null : editor
  const overdueCount = visibleCharges.filter(
    (charge) => charge.estado === "vencido",
  ).length

  return (
    <>
      <AdminPage
        action={
          <div className="flex flex-wrap gap-2">
            {effectiveStudentId && (
              <button
                className="h-11 rounded-xl border border-brand-soft/25 px-4 text-sm font-bold text-brand-soft hover:bg-brand-soft/5 disabled:opacity-50"
                disabled={downloading}
                onClick={downloadAccount}
                type="button"
              >
                {downloading ? "Descargando..." : "Estado de cuenta PDF"}
              </button>
            )}
            {canManage && (
              <button
                className="h-11 rounded-xl bg-brand px-5 text-sm font-bold text-white hover:bg-brand-dark"
                onClick={() => {
                  setError("")
                  setEditor("create")
                }}
                type="button"
              >
                + Registrar cargo
              </button>
            )}
          </div>
        }
        count={
          loading
            ? "Consultando información..."
            : `${charges.length} cargos · ${payments.length} pagos · ${overdueCount} vencidos`
        }
        description="Gestión de cargos y consulta de pagos, estado de cuenta y solvencia."
        title="Módulo financiero"
      >
        <div className="flex flex-col gap-3 border-b border-line p-5 sm:flex-row sm:items-center sm:p-6">
          <div className="flex overflow-x-auto rounded-xl border border-line bg-canvas/50 p-1">
            {[
              ["charges", "Cargos"],
              ["payments", "Pagos"],
              ["solvency", "Solvencia"],
            ].map(([value, label]) => (
              <button
                className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-bold ${
                  view === value
                    ? "bg-white text-brand shadow-sm"
                    : "text-muted"
                }`}
                key={value}
                onClick={() =>
                  setView(value as "charges" | "payments" | "solvency")
                }
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          {(canManage || user.rol === "padre") && (
            <SelectInput
              aria-label="Seleccionar estudiante"
              className="sm:ml-auto sm:max-w-72"
              onChange={(event) => setStudentId(event.target.value)}
              value={studentId}
            >
              {canManage && <option value="">Todos los estudiantes</option>}
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {fullName(student)}
                </option>
              ))}
            </SelectInput>
          )}
        </div>

        {currencyTotals.length > 0 && (
          <div className="grid gap-3 border-b border-line p-5 sm:grid-cols-2 sm:p-6">
            {currencyTotals.map(([currency, totals]) => (
              <div
                className="rounded-xl border border-line bg-canvas/35 p-4"
                key={currency}
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted">
                    Resumen {currency}
                  </p>
                  <StatusBadge
                    tone={totals.pending > 0 ? "warning" : "success"}
                  >
                    {money(currency, totals.pending)} pendiente
                  </StatusBadge>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted">Total cargado</p>
                    <p className="mt-1 text-lg font-bold">
                      {money(currency, totals.original)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">Total pagado</p>
                    <p className="mt-1 text-lg font-bold text-emerald-700">
                      {money(currency, totals.paid)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {notice && <Notice message={notice} onClose={() => setNotice("")} />}
        {error && !editor && !cancelling && !checkout && (
          <div className="mx-5 mt-5 sm:mx-6">
            <ErrorState message={error} onRetry={load} />
          </div>
        )}

        {view === "charges" && (
          <FilterBar
            onSearchChange={setQuery}
            placeholder="Buscar por concepto, descripción o alumno..."
            search={query}
          >
            <SelectInput
              aria-label="Filtrar por estado"
              className="sm:max-w-44"
              onChange={(event) => setStateFilter(event.target.value)}
              value={stateFilter}
            >
              <option value="">Todos los estados</option>
              {CHARGE_STATES.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </SelectInput>
            <TextInput
              aria-label="Fecha inicial"
              className="sm:max-w-40"
              onChange={(event) => setStartDate(event.target.value)}
              type="date"
              value={startDate}
            />
            <TextInput
              aria-label="Fecha final"
              className="sm:max-w-40"
              onChange={(event) => setEndDate(event.target.value)}
              type="date"
              value={endDate}
            />
          </FilterBar>
        )}

        {loading ? (
          <LoadingState rows={5} />
        ) : view === "charges" ? (
          visibleCharges.length ? (
            <DataTable minWidth="min-w-[78rem]">
              <thead>
                <tr className="border-b border-line bg-canvas/45 text-[0.68rem] font-bold uppercase tracking-wider text-muted">
                  <th className="px-6 py-3.5">Alumno y concepto</th>
                  <th className="px-4 py-3.5">Fechas</th>
                  <th className="px-4 py-3.5">Original</th>
                  <th className="px-4 py-3.5">Pagado</th>
                  <th className="px-4 py-3.5">Saldo</th>
                  <th className="px-4 py-3.5">Estado</th>
                  <th className="px-6 py-3.5 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visibleCharges.map((charge) => (
                  <tr className="hover:bg-canvas/40" key={charge.id}>
                    <td className="px-6 py-4">
                      <p className="text-sm font-bold">{charge.concepto}</p>
                      <p className="mt-1 text-xs text-muted">
                        {fullName(charge.alumno)} · Cargo ID {charge.id}
                      </p>
                    </td>
                    <td className="px-4 py-4 text-xs text-muted">
                      <p>Emisión: {date(charge.fechaEmision)}</p>
                      <p className="mt-1">
                        Vence: {date(charge.fechaVencimiento)}
                      </p>
                    </td>
                    <td className="px-4 py-4 text-sm">
                      {money(charge.moneda, charge.montoOriginal)}
                    </td>
                    <td className="px-4 py-4 text-sm text-emerald-700">
                      {money(charge.moneda, charge.montoPagado)}
                    </td>
                    <td className="px-4 py-4 text-sm font-bold">
                      {money(charge.moneda, charge.saldoPendiente)}
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge tone={chargeTone(charge.estado)}>
                        {charge.estado}
                      </StatusBadge>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-2">
                        {canCheckout &&
                          Number(charge.saldoPendiente) > 0 &&
                          charge.estado !== "anulado" && (
                            <button
                              className="rounded-lg bg-brand px-3 py-2 text-xs font-bold text-white"
                              onClick={() => {
                                setError("")
                                setCheckout(charge)
                              }}
                              type="button"
                            >
                              Pagar
                            </button>
                          )}
                        {canManage && charge.estado !== "anulado" && (
                          <>
                            <button
                              className="rounded-lg border border-brand-soft/25 px-3 py-2 text-xs font-bold text-brand-soft hover:bg-brand-soft/5"
                              onClick={() => {
                                setError("")
                                setEditor(charge)
                              }}
                              type="button"
                            >
                              Editar
                            </button>
                            <button
                              className="rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50"
                              onClick={() => {
                                setError("")
                                setCancelling(charge)
                              }}
                              type="button"
                            >
                              Anular
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <EmptyState
              description="No hay cargos visibles con los filtros actuales."
              title="Sin cargos"
            />
          )
        ) : view === "payments" ? (
          payments.length ? (
            <DataTable minWidth="min-w-[70rem]">
              <thead>
                <tr className="border-b border-line bg-canvas/45 text-[0.68rem] font-bold uppercase tracking-wider text-muted">
                  <th className="px-6 py-3.5">Registro</th>
                  <th className="px-4 py-3.5">Alumno</th>
                  <th className="px-4 py-3.5">Cargo</th>
                  <th className="px-4 py-3.5">Monto</th>
                  <th className="px-4 py-3.5">Método</th>
                  <th className="px-4 py-3.5">Fecha</th>
                  <th className="px-6 py-3.5">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {payments.map((payment) => (
                  <tr className="hover:bg-canvas/40" key={payment.id}>
                    <td className="px-6 py-4 font-mono text-xs font-bold text-brand-soft">
                      ID {payment.id}
                    </td>
                    <td className="px-4 py-4 text-sm font-bold">
                      {fullName(payment.alumno)}
                    </td>
                    <td className="px-4 py-4">
                      <p className="text-sm">{payment.concepto}</p>
                      <p className="mt-1 text-xs text-muted">
                        {payment.cargoId
                          ? `Cargo ID ${payment.cargoId}`
                          : "Pago histórico sin cargo"}
                      </p>
                    </td>
                    <td className="px-4 py-4 text-sm font-bold">
                      {money(payment.moneda, payment.monto)}
                    </td>
                    <td className="px-4 py-4 text-sm text-muted">
                      {payment.metodoPago}
                    </td>
                    <td className="px-4 py-4 text-sm text-muted">
                      {date(payment.fechaPago ?? payment.createdAt)}
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge tone={paymentTone(payment.estado)}>
                        {payment.estado}
                      </StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <EmptyState
              description="No hay pagos visibles para esta selección."
              title="Sin historial de pagos"
            />
          )
        ) : solvency ? (
          <div className="space-y-6 p-5 sm:p-6">
            <div
              className={`rounded-2xl border p-6 ${
                solvency.solvente
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-amber-200 bg-amber-50"
              }`}
            >
              <StatusBadge tone={solvency.solvente ? "success" : "warning"}>
                {solvency.solvente ? "Solvente" : "No solvente"}
              </StatusBadge>
              <p className="mt-4 text-2xl font-bold text-ink">
                {solvency.solvente
                  ? "Sin obligaciones pendientes"
                  : `${solvency.cargosPendientes.length} cargos pendientes`}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {Object.entries(solvency.saldoPendientePorMoneda).map(
                  ([currency, amount]) => (
                    <StatusBadge key={currency} tone="warning">
                      {currency}: {money(currency, amount)}
                    </StatusBadge>
                  ),
                )}
              </div>
              {solvency.conciliacionHistoricaRequerida && (
                <p className="mt-4 text-sm leading-6 text-amber-900">
                  Existen pagos históricos sin cargo y la conciliación requiere
                  revisión administrativa.
                </p>
              )}
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <section className="rounded-xl border border-line p-5">
                <h3 className="text-sm font-bold">Requisitos de solvencia</h3>
                <div className="mt-4 space-y-2">
                  {requirements.length ? (
                    requirements.map((requirement) => (
                      <div
                        className="flex items-center justify-between gap-3 rounded-lg bg-canvas/50 px-3 py-2"
                        key={requirement.id}
                      >
                        <span className="text-sm">
                          {requirement.tipoDocumento}
                        </span>
                        <StatusBadge
                          tone={
                            requirement.requiereSolvencia
                              ? "warning"
                              : "neutral"
                          }
                        >
                          {requirement.requiereSolvencia
                            ? "Requiere solvencia"
                            : "No requerida"}
                        </StatusBadge>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted">
                      Sin requisitos configurados.
                    </p>
                  )}
                </div>
              </section>
              <section className="rounded-xl border border-line p-5">
                <h3 className="text-sm font-bold">
                  Pagos históricos sin cargo
                </h3>
                <div className="mt-4 space-y-2">
                  {Object.entries(solvency.pagosHistoricosSinCargo).length ? (
                    Object.entries(solvency.pagosHistoricosSinCargo).map(
                      ([currency, summary]) => (
                        <div
                          className="rounded-lg bg-canvas/50 px-3 py-3"
                          key={currency}
                        >
                          <p className="text-xs font-bold text-muted">
                            {currency} · {summary.cantidad} registros
                          </p>
                          <p className="mt-1 text-sm">
                            Pagado: {money(currency, summary.montoPagado)} ·
                            Pendiente:{" "}
                            {money(currency, summary.montoPendiente)}
                          </p>
                        </div>
                      ),
                    )
                  ) : (
                    <p className="text-sm text-muted">
                      No hay pagos históricos sin cargo.
                    </p>
                  )}
                </div>
              </section>
            </div>
            <div className="rounded-xl border border-dashed border-line bg-canvas/40 p-5">
              <p className="text-sm font-bold">Certificados de solvencia</p>
              <p className="mt-2 text-xs leading-5 text-muted">
                Pendiente de backend: no existen endpoints de solicitud,
                emisión, firma, archivo, descarga, verificación ni historial de
                certificados.
              </p>
            </div>
          </div>
        ) : (
          <EmptyState
            description="Selecciona un estudiante para consultar su solvencia."
            title="Selecciona un estudiante"
          />
        )}
      </AdminPage>

      <Modal
        description={
          record
            ? "El backend determina si el cargo todavía puede editarse."
            : "El ciclo y el período son relaciones opcionales."
        }
        onClose={() => setEditor(null)}
        open={Boolean(editor)}
        title={record ? "Editar cargo" : "Registrar cargo"}
      >
        <form onSubmit={submitCharge}>
          <div className="grid gap-5 px-6 py-6 sm:grid-cols-2">
            {!record && (
              <div className="sm:col-span-2">
                <FormField label="Alumno">
                  <SelectInput name="alumnoId" required>
                    <option value="">Selecciona un alumno</option>
                    {students
                      .filter((student) => student.activo)
                      .map((student) => (
                        <option key={student.id} value={student.id}>
                          {fullName(student)}
                        </option>
                      ))}
                  </SelectInput>
                </FormField>
              </div>
            )}
            <div className="sm:col-span-2">
              <FormField label="Concepto">
                <TextInput
                  defaultValue={record?.concepto}
                  name="concepto"
                  required
                />
              </FormField>
            </div>
            <div className="sm:col-span-2">
              <FormField label="Descripción">
                <TextAreaInput
                  defaultValue={record?.descripcion ?? ""}
                  name="descripcion"
                />
              </FormField>
            </div>
            <FormField label="Monto original">
              <TextInput
                defaultValue={record ? Number(record.montoOriginal) : ""}
                min="0.01"
                name="montoOriginal"
                required
                step="0.01"
                type="number"
              />
            </FormField>
            {!record && (
              <FormField label="Moneda">
                <SelectInput defaultValue="GTQ" name="moneda" required>
                  <option value="GTQ">GTQ</option>
                  <option value="USD">USD</option>
                </SelectInput>
              </FormField>
            )}
            {!record && (
              <FormField label="Fecha de emisión">
                <TextInput name="fechaEmision" type="date" />
              </FormField>
            )}
            <FormField label="Fecha de vencimiento">
              <TextInput
                defaultValue={record?.fechaVencimiento?.slice(0, 10)}
                name="fechaVencimiento"
                type="date"
              />
            </FormField>
            {!record && (
              <>
                <FormField
                  hint="Opcional"
                  label="Ciclo académico"
                >
                  <SelectInput name="cicloAcademicoId">
                    <option value="">Sin ciclo relacionado</option>
                    {cycles.map((cycle) => (
                      <option key={cycle.id} value={cycle.id}>
                        {cycle.nombre}
                      </option>
                    ))}
                  </SelectInput>
                </FormField>
                <FormField
                  hint="Opcional"
                  label="Período académico"
                >
                  <SelectInput name="periodoAcademicoId">
                    <option value="">Sin período relacionado</option>
                    {periods.map((period) => (
                      <option key={period.id} value={period.id}>
                        {period.nombre}
                      </option>
                    ))}
                  </SelectInput>
                </FormField>
              </>
            )}
          </div>
          <FormActions
            error={error}
            label={record ? "Guardar cambios" : "Registrar cargo"}
            onCancel={() => setEditor(null)}
            saving={saving}
          />
        </form>
      </Modal>

      <Modal
        description="La anulación no elimina el cargo y quedará registrada por el backend."
        onClose={() => setCancelling(null)}
        open={Boolean(cancelling)}
        title="Confirmar anulación"
      >
        {cancelling && (
          <form onSubmit={submitCancellation}>
            <div className="space-y-5 px-6 py-6">
              <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                <p className="text-sm font-bold text-red-800">
                  {cancelling.concepto}
                </p>
                <p className="mt-1 text-xs text-red-700">
                  Saldo:{" "}
                  {money(cancelling.moneda, cancelling.saldoPendiente)}
                </p>
              </div>
              <FormField label="Motivo de anulación">
                <TextAreaInput
                  name="motivo"
                  placeholder="Indica por qué debe anularse este cargo..."
                  required
                />
              </FormField>
            </div>
            <FormActions
              error={error}
              label="Confirmar anulación"
              onCancel={() => setCancelling(null)}
              saving={saving}
            />
          </form>
        )}
      </Modal>

      <Modal
        description="Serás redirigido a Stripe Checkout. No utilices tarjetas reales durante las pruebas."
        onClose={() => setCheckout(null)}
        open={Boolean(checkout)}
        title="Iniciar pago en línea"
      >
        {checkout && (
          <form onSubmit={submitCheckout}>
            <div className="space-y-5 px-6 py-6">
              <div className="rounded-xl bg-canvas/60 p-4">
                <p className="text-sm font-bold">{checkout.concepto}</p>
                <p className="mt-2 text-xs text-muted">Saldo actual</p>
                <p className="mt-1 text-2xl font-bold text-brand">
                  {money(checkout.moneda, checkout.saldoPendiente)}
                </p>
              </div>
              <FormField
                hint="Puedes indicar un pago parcial. Nunca puede superar el saldo pendiente."
                label={`Monto a pagar (${checkout.moneda})`}
              >
                <TextInput
                  defaultValue={Number(checkout.saldoPendiente)}
                  max={Number(checkout.saldoPendiente)}
                  min="0.01"
                  name="monto"
                  required
                  step="0.01"
                  type="number"
                />
              </FormField>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
                Regresar desde Stripe no confirma el pago. El portal consultará
                el estado registrado por el webhook mediante GET /api/pagos.
              </div>
            </div>
            <FormActions
              error={error}
              label="Continuar a Stripe"
              onCancel={() => setCheckout(null)}
              saving={saving}
            />
          </form>
        )}
      </Modal>
    </>
  )
}
