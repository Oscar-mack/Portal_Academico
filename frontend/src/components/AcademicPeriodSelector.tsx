import { useMemo } from "react"
import { useAcademicPeriod } from "../context/AcademicPeriodContext"
import StatusBadge from "./StatusBadge"

export default function AcademicPeriodSelector() {
  const {
    cycles,
    periods,
    selectedPeriodId,
    selectedPeriod,
    loading,
    error,
    selectPeriod,
  } = useAcademicPeriod()

  const groupedPeriods = useMemo(
    () =>
      cycles
        .map((cycle) => ({
          cycle,
          periods: periods.filter((period) => period.cicloAcademicoId === cycle.id),
        }))
        .filter((group) => group.periods.length > 0),
    [cycles, periods],
  )

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="hidden text-right xl:block">
        <p className="text-[0.62rem] font-bold uppercase tracking-[0.14em] text-muted">
          Período académico
        </p>
        <div className="mt-0.5 flex items-center justify-end gap-2">
          {selectedPeriod && (
            <StatusBadge tone={selectedPeriod.estado === "abierto" ? "success" : "neutral"}>
              {selectedPeriod.estado === "abierto" ? "Activo" : "Histórico"}
            </StatusBadge>
          )}
        </div>
      </div>
      <select
        aria-label="Período académico global"
        className="h-10 max-w-52 rounded-xl border border-line bg-white px-3 text-xs font-bold text-ink outline-none transition focus:border-brand-soft focus:ring-4 focus:ring-brand-soft/10 disabled:cursor-wait disabled:text-muted"
        disabled={loading}
        onChange={(event) => {
          const value = event.target.value
          selectPeriod(value ? Number(value) : null)
        }}
        title={error || "Filtra el portal por período académico"}
        value={selectedPeriodId ?? ""}
      >
        <option value="">{loading ? "Consultando períodos..." : "Todos los períodos"}</option>
        {groupedPeriods.map(({ cycle, periods: cyclePeriods }) => (
          <optgroup key={cycle.id} label={cycle.nombre}>
            {cyclePeriods.map((period) => (
              <option key={period.id} value={period.id}>
                {period.nombre} · {period.estado === "abierto" ? "Abierto" : "Cerrado"}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  )
}
