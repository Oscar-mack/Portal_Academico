import { useCallback, useEffect, useMemo, useState } from "react"
import AdminPage from "../components/AdminPage"
import DataTable from "../components/DataTable"
import EmptyState from "../components/EmptyState"
import ErrorState from "../components/ErrorState"
import FilterBar from "../components/FilterBar"
import { SelectInput } from "../components/FormField"
import LoadingState from "../components/LoadingState"
import StatusBadge from "../components/StatusBadge"
import { useAcademicPeriod } from "../context/AcademicPeriodContext"
import { evaluationsService } from "../services/evaluationsService"
import type { Evaluacion } from "../types/api"

export default function StudentEvaluationsPage() {
  const { periods, selectedPeriodId, selectedPeriod } = useAcademicPeriod()
  const [items, setItems] = useState<Evaluacion[]>([])
  const [courseFilter, setCourseFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      setItems(
        await evaluationsService.list({
          periodoAcademicoId: selectedPeriodId ?? undefined,
        }),
      )
    } catch (requestError) {
      setItems([])
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible consultar tus evaluaciones.",
      )
    } finally {
      setLoading(false)
    }
  }, [selectedPeriodId])

  useEffect(() => {
    load()
  }, [load])

  const courses = useMemo(
    () =>
      Array.from(
        new Map(
          items
            .filter((evaluation) => evaluation.curso)
            .map((evaluation) => [evaluation.cursoId, evaluation.curso!]),
        ).values(),
      ),
    [items],
  )

  const visibleItems = useMemo(() => {
    const term = query.trim().toLowerCase()
    return items.filter((evaluation) => {
      const graded = Boolean(evaluation.calificaciones?.length)
      const courseName = evaluation.curso?.nombre ?? ""
      return (
        (!courseFilter || evaluation.cursoId === Number(courseFilter)) &&
        (!statusFilter ||
          (statusFilter === "graded" ? graded : !graded)) &&
        (!term ||
          evaluation.nombre.toLowerCase().includes(term) ||
          courseName.toLowerCase().includes(term) ||
          (evaluation.curso?.codigo ?? "").toLowerCase().includes(term))
      )
    })
  }, [items, courseFilter, statusFilter, query])

  return (
    <AdminPage
      count={
        loading
          ? "Consultando tus evaluaciones..."
          : error
            ? "No se pudieron consultar tus evaluaciones"
            : `${visibleItems.length} evaluaciones visibles`
      }
      description="Consulta las evaluaciones de tus cursos. Las notas finales publicadas están en Mis calificaciones."
      title="Mis evaluaciones"
    >
      <div className="border-b border-line bg-brand-soft/5 px-5 py-3 text-xs leading-5 text-muted sm:px-6">
        Pendiente significa que aún no se registró tu calificación. Las
        evaluaciones actuales no tienen fechas límite; las notas finales
        oficiales se consultan por separado.
      </div>
      <FilterBar
        onSearchChange={setQuery}
        placeholder="Buscar evaluación o curso..."
        search={query}
      >
        <SelectInput
          aria-label="Filtrar por curso"
          className="sm:max-w-56"
          onChange={(event) => setCourseFilter(event.target.value)}
          value={courseFilter}
        >
          <option value="">Todos los cursos</option>
          {courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.codigo} · {course.nombre}
            </option>
          ))}
        </SelectInput>
        <SelectInput
          aria-label="Filtrar por estado de evaluación"
          className="sm:max-w-48"
          onChange={(event) => setStatusFilter(event.target.value)}
          value={statusFilter}
        >
          <option value="">Todos los estados</option>
          <option value="pending">Pendientes</option>
          <option value="graded">Calificadas</option>
        </SelectInput>
      </FilterBar>
      {error && (
        <div className="mx-5 mt-5 sm:mx-6">
          <ErrorState message={error} onRetry={load} />
        </div>
      )}
      {loading ? (
        <LoadingState />
      ) : error ? null : visibleItems.length ? (
        <DataTable minWidth="min-w-[48rem]">
          <thead>
            <tr className="border-b border-line bg-canvas/45 text-[0.68rem] font-bold uppercase tracking-wider text-muted">
              <th className="px-6 py-3.5">Evaluación</th>
              <th className="px-4 py-3.5">Curso</th>
              <th className="px-4 py-3.5">Período</th>
              <th className="px-4 py-3.5">Puntaje máximo</th>
              <th className="px-6 py-3.5">Estado / puntaje</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {visibleItems.map((evaluation) => {
              const grade = evaluation.calificaciones?.[0]
              return (
                <tr className="hover:bg-canvas/40" key={evaluation.id}>
                  <td className="px-6 py-4 text-sm font-bold">
                    {evaluation.nombre}
                  </td>
                  <td className="px-4 py-4">
                    <p className="text-sm font-bold">
                      {evaluation.curso?.nombre ??
                        `Curso ID ${evaluation.cursoId}`}
                    </p>
                    <p className="mt-1 font-mono text-xs text-brand-soft">
                      {evaluation.curso?.codigo}
                    </p>
                  </td>
                  <td className="px-4 py-4 text-sm text-muted">
                    {periods.find(
                      (period) =>
                        period.id === evaluation.periodoAcademicoId,
                    )?.nombre ?? `Período ID ${evaluation.periodoAcademicoId}`}
                  </td>
                  <td className="px-4 py-4 text-sm font-bold">
                    {Number(evaluation.puntajeMaximo)}
                  </td>
                  <td className="px-6 py-4">
                    {grade ? (
                      <StatusBadge tone="success">
                        Calificada · {Number(grade.valor)}/
                        {Number(evaluation.puntajeMaximo)}
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone="warning">Pendiente</StatusBadge>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </DataTable>
      ) : (
        <EmptyState
          description={
            selectedPeriod
              ? `No hay evaluaciones para tus cursos en ${selectedPeriod.nombre} con estos filtros.`
              : "No hay evaluaciones para tus cursos con estos filtros."
          }
          title="Sin evaluaciones disponibles"
        />
      )}
    </AdminPage>
  )
}
