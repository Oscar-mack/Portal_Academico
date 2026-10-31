import { FormEvent, useMemo, useState } from "react"
import AdminPage from "../../components/AdminPage"
import DataTable from "../../components/DataTable"
import EmptyState from "../../components/EmptyState"
import ErrorState from "../../components/ErrorState"
import FilterBar from "../../components/FilterBar"
import { FormField, SelectInput, TextInput } from "../../components/FormField"
import LoadingState from "../../components/LoadingState"
import Modal from "../../components/Modal"
import StatusBadge from "../../components/StatusBadge"
import { useAcademicPeriod } from "../../context/AcademicPeriodContext"
import { academicPeriodsService } from "../../services/academicPeriodsService"
import type { CicloAcademico, PeriodoAcademico, PeriodType } from "../../types/api"

type Tab = "cycles" | "periods"
type Editor =
  | { type: "cycle"; item?: CicloAcademico }
  | { type: "period"; item?: PeriodoAcademico }
  | null

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("es-GT", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`),
  )
}

export default function AcademicPeriodsPage() {
  const { cycles, periods, loading, error, refresh } = useAcademicPeriod()
  const [tab, setTab] = useState<Tab>("cycles")
  const [query, setQuery] = useState("")
  const [cycleFilter, setCycleFilter] = useState("")
  const [editor, setEditor] = useState<Editor>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState("")
  const [notice, setNotice] = useState("")

  const visibleCycles = useMemo(() => {
    const term = query.toLowerCase().trim()
    return cycles.filter((cycle) => !term || cycle.nombre.toLowerCase().includes(term))
  }, [cycles, query])

  const visiblePeriods = useMemo(() => {
    const term = query.toLowerCase().trim()
    return periods.filter(
      (period) =>
        (!cycleFilter || period.cicloAcademicoId === Number(cycleFilter)) &&
        (!term ||
          period.nombre.toLowerCase().includes(term) ||
          period.tipo.toLowerCase().includes(term)),
    )
  }, [periods, query, cycleFilter])

  async function submitCycle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const item = editor?.type === "cycle" ? editor.item : undefined
    setSaving(true)
    setFormError("")

    try {
      if (item) {
        await academicPeriodsService.updateCycle(item.id, {
          nombre: String(form.get("nombre") ?? "").trim(),
          fechaInicio: String(form.get("fechaInicio") ?? ""),
          fechaFin: String(form.get("fechaFin") ?? ""),
          estado: String(form.get("estado")) as "abierto" | "cerrado",
        })
        setNotice("El ciclo académico se actualizó correctamente.")
      } else {
        await academicPeriodsService.createCycle({
          nombre: String(form.get("nombre") ?? "").trim(),
          fechaInicio: String(form.get("fechaInicio") ?? ""),
          fechaFin: String(form.get("fechaFin") ?? ""),
        })
        setNotice("El ciclo académico se creó correctamente.")
      }
      await refresh()
      setEditor(null)
    } catch (requestError) {
      setFormError(
        requestError instanceof Error ? requestError.message : "No fue posible guardar el ciclo.",
      )
    } finally {
      setSaving(false)
    }
  }

  async function submitPeriod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const item = editor?.type === "period" ? editor.item : undefined
    setSaving(true)
    setFormError("")

    try {
      if (item) {
        await academicPeriodsService.updatePeriod(item.id, {
          nombre: String(form.get("nombre") ?? "").trim(),
          tipo: String(form.get("tipo")) as PeriodType,
          fechaInicio: String(form.get("fechaInicio") ?? ""),
          fechaFin: String(form.get("fechaFin") ?? ""),
          estado: String(form.get("estado")) as "abierto" | "cerrado",
        })
        setNotice("El período académico se actualizó correctamente.")
      } else {
        await academicPeriodsService.createPeriod({
          cicloAcademicoId: Number(form.get("cicloAcademicoId")),
          nombre: String(form.get("nombre") ?? "").trim(),
          tipo: String(form.get("tipo")) as PeriodType,
          fechaInicio: String(form.get("fechaInicio") ?? ""),
          fechaFin: String(form.get("fechaFin") ?? ""),
        })
        setNotice("El período académico se creó correctamente.")
      }
      await refresh()
      setEditor(null)
    } catch (requestError) {
      setFormError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible guardar el período.",
      )
    } finally {
      setSaving(false)
    }
  }

  const activeEditorItem = editor?.item

  return (
    <>
      <AdminPage
        action={
          <button
            className="h-11 rounded-xl bg-brand px-5 text-sm font-bold text-white transition hover:bg-brand-dark"
            onClick={() => {
              setFormError("")
              setEditor({ type: tab === "cycles" ? "cycle" : "period" })
            }}
            type="button"
          >
            + {tab === "cycles" ? "Nuevo ciclo" : "Nuevo período"}
          </button>
        }
        count={
          loading
            ? "Consultando estructura académica..."
            : `${cycles.length} ciclos · ${periods.length} períodos`
        }
        description="Organiza la información institucional por ciclos y períodos."
        title="Ciclos y períodos académicos"
      >
        <div className="flex border-b border-line px-5 pt-4 sm:px-6">
          {[
            ["cycles", "Ciclos"],
            ["periods", "Períodos"],
          ].map(([value, label]) => (
            <button
              className={`border-b-2 px-4 py-3 text-sm font-bold transition ${
                tab === value
                  ? "border-brand-soft text-brand-soft"
                  : "border-transparent text-muted hover:text-ink"
              }`}
              key={value}
              onClick={() => {
                setTab(value as Tab)
                setQuery("")
              }}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>

        <FilterBar
          onSearchChange={setQuery}
          placeholder={tab === "cycles" ? "Buscar ciclo..." : "Buscar período o tipo..."}
          search={query}
        >
          {tab === "periods" && (
            <SelectInput
              aria-label="Filtrar por ciclo"
              className="sm:max-w-60"
              onChange={(event) => setCycleFilter(event.target.value)}
              value={cycleFilter}
            >
              <option value="">Todos los ciclos</option>
              {cycles.map((cycle) => (
                <option key={cycle.id} value={cycle.id}>
                  {cycle.nombre}
                </option>
              ))}
            </SelectInput>
          )}
        </FilterBar>

        {notice && (
          <div className="mx-5 mt-5 flex justify-between gap-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 sm:mx-6">
            <span>{notice}</span>
            <button onClick={() => setNotice("")} type="button">
              ×
            </button>
          </div>
        )}
        {error && (
          <div className="mx-5 mt-5 sm:mx-6">
            <ErrorState message={error} onRetry={refresh} />
          </div>
        )}

        {loading ? (
          <LoadingState />
        ) : tab === "cycles" ? (
          visibleCycles.length ? (
            <DataTable>
              <thead>
                <tr className="border-b border-line bg-canvas/45 text-[0.68rem] font-bold uppercase tracking-wider text-muted">
                  <th className="px-6 py-3.5">Ciclo</th>
                  <th className="px-4 py-3.5">Inicio</th>
                  <th className="px-4 py-3.5">Finalización</th>
                  <th className="px-4 py-3.5">Períodos</th>
                  <th className="px-4 py-3.5">Estado</th>
                  <th className="px-6 py-3.5 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visibleCycles.map((cycle) => (
                  <tr className="hover:bg-canvas/40" key={cycle.id}>
                    <td className="px-6 py-4 text-sm font-bold">{cycle.nombre}</td>
                    <td className="px-4 py-4 text-sm text-muted">{dateLabel(cycle.fechaInicio)}</td>
                    <td className="px-4 py-4 text-sm text-muted">{dateLabel(cycle.fechaFin)}</td>
                    <td className="px-4 py-4 text-sm text-muted">
                      {periods.filter((period) => period.cicloAcademicoId === cycle.id).length}
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge tone={cycle.estado === "abierto" ? "success" : "neutral"}>
                        {cycle.estado === "abierto" ? "Abierto" : "Cerrado"}
                      </StatusBadge>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        className="rounded-lg border border-brand-soft/25 px-3 py-2 text-xs font-bold text-brand-soft hover:bg-brand-soft/5"
                        onClick={() => {
                          setFormError("")
                          setEditor({ type: "cycle", item: cycle })
                        }}
                        type="button"
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <EmptyState
              description="Crea el primer ciclo para comenzar a organizar los períodos académicos."
              title="No hay ciclos académicos"
            />
          )
        ) : visiblePeriods.length ? (
          <DataTable>
            <thead>
              <tr className="border-b border-line bg-canvas/45 text-[0.68rem] font-bold uppercase tracking-wider text-muted">
                <th className="px-6 py-3.5">Período</th>
                <th className="px-4 py-3.5">Ciclo</th>
                <th className="px-4 py-3.5">Tipo</th>
                <th className="px-4 py-3.5">Fechas</th>
                <th className="px-4 py-3.5">Estado</th>
                <th className="px-6 py-3.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visiblePeriods.map((period) => (
                <tr className="hover:bg-canvas/40" key={period.id}>
                  <td className="px-6 py-4 text-sm font-bold">{period.nombre}</td>
                  <td className="px-4 py-4 text-sm text-muted">
                    {period.cicloAcademico?.nombre ??
                      cycles.find((cycle) => cycle.id === period.cicloAcademicoId)?.nombre ??
                      `Ciclo ${period.cicloAcademicoId}`}
                  </td>
                  <td className="px-4 py-4 text-sm capitalize text-muted">{period.tipo}</td>
                  <td className="px-4 py-4 text-xs text-muted">
                    {dateLabel(period.fechaInicio)} – {dateLabel(period.fechaFin)}
                  </td>
                  <td className="px-4 py-4">
                    <StatusBadge tone={period.estado === "abierto" ? "success" : "neutral"}>
                      {period.estado === "abierto" ? "Activo" : "Histórico"}
                    </StatusBadge>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      className="rounded-lg border border-brand-soft/25 px-3 py-2 text-xs font-bold text-brand-soft hover:bg-brand-soft/5"
                      onClick={() => {
                        setFormError("")
                        setEditor({ type: "period", item: period })
                      }}
                      type="button"
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : (
          <EmptyState
            description="No existen períodos que coincidan con los filtros seleccionados."
            title="No hay períodos académicos"
          />
        )}
      </AdminPage>

      <Modal
        description={
          editor?.type === "cycle"
            ? "Las fechas deben contener todos los períodos existentes del ciclo."
            : "Las fechas deben estar dentro del ciclo y no pueden traslaparse."
        }
        onClose={() => setEditor(null)}
        open={Boolean(editor)}
        title={
          editor?.type === "cycle"
            ? activeEditorItem
              ? "Editar ciclo académico"
              : "Crear ciclo académico"
            : activeEditorItem
              ? "Editar período académico"
              : "Crear período académico"
        }
      >
        {editor?.type === "cycle" ? (
          <form onSubmit={submitCycle}>
            <div className="grid gap-5 px-6 py-6 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <FormField label="Nombre del ciclo">
                  <TextInput defaultValue={editor.item?.nombre} name="nombre" required />
                </FormField>
              </div>
              <FormField label="Fecha de inicio">
                <TextInput
                  defaultValue={editor.item?.fechaInicio}
                  name="fechaInicio"
                  required
                  type="date"
                />
              </FormField>
              <FormField label="Fecha de finalización">
                <TextInput
                  defaultValue={editor.item?.fechaFin}
                  name="fechaFin"
                  required
                  type="date"
                />
              </FormField>
              {editor.item && (
                <div className="sm:col-span-2">
                  <FormField
                    hint="El backend no permite cerrar un ciclo con períodos abiertos."
                    label="Estado"
                  >
                    <SelectInput defaultValue={editor.item.estado} name="estado">
                      <option value="abierto">Abierto</option>
                      <option value="cerrado">Cerrado</option>
                    </SelectInput>
                  </FormField>
                </div>
              )}
            </div>
            <ModalActions
              error={formError}
              label={editor.item ? "Guardar cambios" : "Crear ciclo"}
              onCancel={() => setEditor(null)}
              saving={saving}
            />
          </form>
        ) : editor?.type === "period" ? (
          <form onSubmit={submitPeriod}>
            <div className="grid gap-5 px-6 py-6 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <FormField label="Ciclo académico">
                  <SelectInput
                    defaultValue={editor.item?.cicloAcademicoId}
                    disabled={Boolean(editor.item)}
                    name="cicloAcademicoId"
                    required
                  >
                    <option value="">Selecciona un ciclo</option>
                    {cycles.map((cycle) => (
                      <option key={cycle.id} value={cycle.id}>
                        {cycle.nombre}
                      </option>
                    ))}
                  </SelectInput>
                </FormField>
              </div>
              <FormField label="Nombre del período">
                <TextInput defaultValue={editor.item?.nombre} name="nombre" required />
              </FormField>
              <FormField label="Tipo">
                <SelectInput defaultValue={editor.item?.tipo ?? "semestre"} name="tipo" required>
                  <option value="bimestre">Bimestre</option>
                  <option value="trimestre">Trimestre</option>
                  <option value="semestre">Semestre</option>
                </SelectInput>
              </FormField>
              <FormField label="Fecha de inicio">
                <TextInput
                  defaultValue={editor.item?.fechaInicio}
                  name="fechaInicio"
                  required
                  type="date"
                />
              </FormField>
              <FormField label="Fecha de finalización">
                <TextInput
                  defaultValue={editor.item?.fechaFin}
                  name="fechaFin"
                  required
                  type="date"
                />
              </FormField>
              {editor.item && (
                <div className="sm:col-span-2">
                  <FormField label="Estado">
                    <SelectInput defaultValue={editor.item.estado} name="estado">
                      <option value="abierto">Abierto</option>
                      <option value="cerrado">Cerrado</option>
                    </SelectInput>
                  </FormField>
                </div>
              )}
            </div>
            <ModalActions
              error={formError}
              label={editor.item ? "Guardar cambios" : "Crear período"}
              onCancel={() => setEditor(null)}
              saving={saving}
            />
          </form>
        ) : null}
      </Modal>
    </>
  )
}

function ModalActions({
  error,
  label,
  saving,
  onCancel,
}: {
  error: string
  label: string
  saving: boolean
  onCancel: () => void
}) {
  return (
    <>
      {error && (
        <div className="mx-6 mb-5">
          <ErrorState message={error} />
        </div>
      )}
      <div className="flex justify-end gap-3 border-t border-line bg-canvas/45 px-6 py-4">
        <button
          className="rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-bold text-muted"
          disabled={saving}
          onClick={onCancel}
          type="button"
        >
          Cancelar
        </button>
        <button
          className="rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60"
          disabled={saving}
          type="submit"
        >
          {saving ? "Guardando..." : label}
        </button>
      </div>
    </>
  )
}
