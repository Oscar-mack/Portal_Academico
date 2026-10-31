import { useCallback, useEffect, useState } from "react"
import AdminPage from "../components/AdminPage"
import DataTable from "../components/DataTable"
import EmptyState from "../components/EmptyState"
import ErrorState from "../components/ErrorState"
import LoadingState from "../components/LoadingState"
import StatusBadge from "../components/StatusBadge"
import { useAcademicPeriod } from "../context/AcademicPeriodContext"
import type { AuthUser } from "../lib/api"
import {
  reportsService,
  type AcademicIndicators,
  type TeacherReport,
} from "../services/reportsService"

export default function ReportsPage({ user }: { user: AuthUser }) {
  const { selectedPeriodId } = useAcademicPeriod()
  const [indicators, setIndicators] = useState<AcademicIndicators | null>(null)
  const [teacherReport, setTeacherReport] = useState<TeacherReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      if (user.rol === "admin") {
        setIndicators(
          await reportsService.academicIndicators({
            periodoAcademicoId: selectedPeriodId ?? undefined,
          }),
        )
      } else if (user.rol === "catedratico" && user.catedraticoId) {
        setTeacherReport(
          await reportsService.teacherReport(Number(user.catedraticoId), {
            periodoAcademicoId: selectedPeriodId ?? undefined,
          }),
        )
      } else {
        throw new Error(
          "La cuenta no tiene un perfil de catedrático asociado.",
        )
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible consultar el reporte.",
      )
    } finally {
      setLoading(false)
    }
  }, [selectedPeriodId, user.catedraticoId, user.rol])

  useEffect(() => {
    load()
  }, [load])

  return (
    <AdminPage
      count={
        loading
          ? "Consultando reporte..."
          : user.rol === "admin"
            ? `${indicators?.totalNotasEvaluadas ?? 0} notas evaluadas`
            : `${teacherReport?.totalNotas ?? 0} notas del docente`
      }
      description="Información calculada por los endpoints de reportes del backend."
      title={user.rol === "admin" ? "Reportes académicos" : "Reporte docente"}
    >
      {error && (
        <div className="mx-5 mt-5 sm:mx-6">
          <ErrorState message={error} onRetry={load} />
        </div>
      )}
      {loading ? (
        <LoadingState rows={5} />
      ) : indicators ? (
        <div className="space-y-6 p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Alumnos", indicators.totalAlumnos],
              ["Notas evaluadas", indicators.totalNotasEvaluadas],
              ["Aprobados", indicators.aprobados],
              ["Reprobados", indicators.reprobados],
            ].map(([label, value]) => (
              <div className="rounded-xl border border-line bg-canvas/35 p-4" key={label}>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">
                  {label}
                </p>
                <p className="mt-2 text-2xl font-bold text-brand">{value}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-line p-5">
              <p className="text-sm font-bold">Porcentaje de aprobación</p>
              <p className="mt-3 text-4xl font-bold text-brand">
                {indicators.porcentajeAprobacion.toFixed(2)}%
              </p>
              <p className="mt-2 text-xs text-muted">
                Umbral definido por el backend: {indicators.umbralAprobacion}
              </p>
            </div>
            <div className="rounded-xl border border-line p-5">
              <p className="text-sm font-bold">Distribución por rango</p>
              <div className="mt-4 space-y-2">
                {Object.entries(indicators.distribucionPorRango).map(
                  ([range, count]) => (
                    <div className="flex justify-between text-sm" key={range}>
                      <span className="text-muted">{range}</span>
                      <span className="font-bold">{count}</span>
                    </div>
                  ),
                )}
              </div>
            </div>
          </div>
        </div>
      ) : teacherReport?.notas.length ? (
        <DataTable minWidth="min-w-[58rem]">
          <thead>
            <tr className="border-b border-line bg-canvas/45 text-[0.68rem] font-bold uppercase tracking-wider text-muted">
              <th className="px-6 py-3.5">Estudiante</th>
              <th className="px-4 py-3.5">Curso</th>
              <th className="px-4 py-3.5">Nota</th>
              <th className="px-4 py-3.5">Resultado</th>
              <th className="px-6 py-3.5">Publicación</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {teacherReport.notas.map((note) => (
              <tr className="hover:bg-canvas/40" key={note.id}>
                <td className="px-6 py-4 text-sm font-bold">
                  {note.alumno
                    ? `${note.alumno.nombre} ${note.alumno.apellido}`
                    : `Alumno ID ${note.alumnoId}`}
                </td>
                <td className="px-4 py-4 text-sm">
                  {note.curso?.nombre ?? `Curso ID ${note.cursoId}`}
                </td>
                <td className="px-4 py-4 text-lg font-bold text-brand">
                  {Number(note.valor).toFixed(2)}
                </td>
                <td className="px-4 py-4">
                  <StatusBadge
                    tone={note.estado === "aprobado" ? "success" : "danger"}
                  >
                    {note.estado}
                  </StatusBadge>
                </td>
                <td className="px-6 py-4">
                  <StatusBadge tone={note.publicadaEn ? "info" : "warning"}>
                    {note.publicadaEn ? "Publicada" : "Pendiente"}
                  </StatusBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : (
        <EmptyState
          description="No hay información disponible para el período seleccionado."
          title="Sin datos de reporte"
        />
      )}
    </AdminPage>
  )
}
