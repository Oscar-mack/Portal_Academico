import { useCallback, useEffect, useState } from "react"
import AdminPage from "../components/AdminPage"
import EmptyState from "../components/EmptyState"
import ErrorState from "../components/ErrorState"
import LoadingState from "../components/LoadingState"
import StatusBadge from "../components/StatusBadge"
import { useAcademicPeriod } from "../context/AcademicPeriodContext"
import { academicAssignmentsService } from "../services/academicAssignmentsService"
import type { OfertaCurso } from "../types/api"

function date(value: string) {
  return new Intl.DateTimeFormat("es-GT", { dateStyle: "medium" }).format(
    new Date(`${value}T00:00:00`),
  )
}

export default function CourseEnrollmentPage() {
  const { selectedPeriod, selectedPeriodId } = useAcademicPeriod()
  const [offers, setOffers] = useState<OfertaCurso[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const load = useCallback(async () => {
    if (!selectedPeriodId) {
      setOffers([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError("")
    try {
      setOffers(
        await academicAssignmentsService.listAvailableCourseOffers(
          selectedPeriodId,
        ),
      )
    } catch (requestError) {
      setOffers([])
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible consultar las secciones disponibles.",
      )
    } finally {
      setLoading(false)
    }
  }, [selectedPeriodId])

  useEffect(() => {
    load()
  }, [load])

  async function enroll(offer: OfertaCurso) {
    setSavingId(offer.id)
    setError("")
    setNotice("")
    try {
      await academicAssignmentsService.enrollInCourseOffer(offer.id)
      setNotice(`Te inscribiste en ${offer.curso?.nombre ?? "el curso"} · sección ${offer.codigoSeccion}.`)
      await load()
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible completar la inscripción.",
      )
    } finally {
      setSavingId(null)
    }
  }

  return (
    <AdminPage
      count={
        loading
          ? "Consultando secciones..."
          : error && offers.length === 0
            ? "No se pudieron consultar las secciones"
            : `${offers.length} secciones`
      }
      description="Inscríbete en una sección abierta de tu programa. El servidor valida período, cupo, fechas, duplicados y cruces de horario."
      title="Inscripción de cursos"
    >
      {notice && (
        <div className="m-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 sm:mx-6">
          {notice}
        </div>
      )}
      {error && (
        <div className="m-5 sm:mx-6">
          <ErrorState message={error} onRetry={load} />
        </div>
      )}
      {loading ? (
        <LoadingState rows={4} />
      ) : error && offers.length === 0 ? null : !selectedPeriodId ? (
        <EmptyState
          description="Selecciona primero un período académico para consultar sus secciones."
          title="Período no seleccionado"
        />
      ) : offers.length === 0 ? (
        <EmptyState
          description={`No hay secciones ofertadas para tu programa en ${selectedPeriod?.nombre ?? "el período seleccionado"}.`}
          title="Sin secciones disponibles"
        />
      ) : (
        <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6 xl:grid-cols-3">
          {offers.map((offer) => (
            <article
              className="flex flex-col rounded-2xl border border-line bg-white p-5 shadow-sm"
              key={offer.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-brand-soft">
                    {offer.curso?.codigo} · Sección {offer.codigoSeccion}
                  </p>
                  <h2 className="mt-2 text-lg font-bold text-ink">
                    {offer.curso?.nombre ?? "Curso"}
                  </h2>
                </div>
                <StatusBadge tone={offer.registrationOpen ? "success" : "warning"}>
                  {offer.registrationOpen ? "Abierta" : "No disponible"}
                </StatusBadge>
              </div>
              <p className="mt-2 text-sm text-muted">
                {offer.curso?.gradoCarrera?.nombre ?? "Programa académico"} ·{" "}
                {offer.catedratico
                  ? `${offer.catedratico.nombre} ${offer.catedratico.apellido}`
                  : "Docente asignado"}
              </p>
              <div className="mt-4 rounded-xl bg-canvas/55 p-3 text-xs text-muted">
                <p>
                  Cupos: {offer.seatsAvailable ?? 0} disponibles de{" "}
                  {offer.cupoMaximo}
                </p>
                <p className="mt-1">
                  Inscripción: {date(offer.fechaInscripcionInicio)} –{" "}
                  {date(offer.fechaInscripcionFin)}
                </p>
              </div>
              <div className="mt-4 flex-1 space-y-2">
                {offer.horarios?.length ? (
                  offer.horarios.map((schedule) => (
                    <p
                      className="rounded-lg border border-line px-3 py-2 text-xs font-semibold"
                      key={schedule.id}
                    >
                      {schedule.dia} · {schedule.horaInicio.slice(0, 5)}–
                      {schedule.horaFin.slice(0, 5)}
                    </p>
                  ))
                ) : (
                  <p className="text-xs text-muted">
                    Sin horario configurado; consulta con administración.
                  </p>
                )}
              </div>
              {offer.registrationReason && (
                <p className="mt-4 text-xs leading-5 text-amber-800">
                  {offer.registrationReason}
                </p>
              )}
              <button
                className="mt-5 h-11 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!offer.registrationOpen || savingId !== null}
                onClick={() => enroll(offer)}
                type="button"
              >
                {savingId === offer.id ? "Inscribiendo..." : "Inscribirme"}
              </button>
            </article>
          ))}
        </div>
      )}
    </AdminPage>
  )
}
