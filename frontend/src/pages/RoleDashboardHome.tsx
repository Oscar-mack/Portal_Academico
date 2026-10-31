import { useCallback, useEffect, useMemo, useState } from "react"
import ErrorState from "../components/ErrorState"
import { SelectInput } from "../components/FormField"
import LoadingState from "../components/LoadingState"
import StatusBadge from "../components/StatusBadge"
import { useAcademicPeriod } from "../context/AcademicPeriodContext"
import type { AuthUser } from "../lib/api"
import { downloadBlob } from "../lib/download"
import { academicAssignmentsService } from "../services/academicAssignmentsService"
import { evaluationsService } from "../services/evaluationsService"
import { financeService } from "../services/financeService"
import { notesService } from "../services/notesService"
import type {
  DashboardResponse,
  Evaluacion,
  HorarioCatedratico,
  StudentDashboardSummary,
} from "../types/api"

type HomeIcon =
  | "people"
  | "book"
  | "grade"
  | "money"
  | "calendar"
  | "document"
  | "arrow"

function HomeIcon({ name }: { name: HomeIcon }) {
  const paths: Record<HomeIcon, React.ReactNode> = {
    people: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20v-2a6 6 0 0 1 12 0v2M17 9a3 3 0 0 1 0 6M18 17c2 .4 3 1.4 3 3" />
      </>
    ),
    book: (
      <>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
      </>
    ),
    grade: <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />,
    money: (
      <>
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M2 10h20M6 15h2" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M8 2v4M16 2v4M3 10h18" />
      </>
    ),
    document: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6M8 13h8M8 17h6" />
      </>
    ),
    arrow: <path d="m9 18 6-6-6-6" />,
  }
  return (
    <svg
      aria-hidden="true"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {paths[name]}
    </svg>
  )
}

function formatMoney(currency: string, amount: number) {
  return new Intl.NumberFormat("es-GT", {
    style: "currency",
    currency,
  }).format(amount)
}

function Metric({
  label,
  value,
  detail,
  icon,
  tone = "teal",
}: {
  label: string
  value: string | number
  detail: string
  icon: HomeIcon
  tone?: "teal" | "blue" | "amber" | "violet"
}) {
  const tones = {
    teal: "bg-brand-soft/10 text-brand-soft",
    blue: "bg-blue-500/10 text-blue-600",
    amber: "bg-amber-500/12 text-amber-700",
    violet: "bg-violet-500/10 text-violet-600",
  }
  return (
    <article className="rounded-2xl border border-line bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-muted">{label}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-ink">
            {value}
          </p>
        </div>
        <div className={`grid size-11 place-items-center rounded-xl ${tones[tone]}`}>
          <HomeIcon name={icon} />
        </div>
      </div>
      <p className="mt-4 text-xs font-semibold text-brand-soft">{detail}</p>
    </article>
  )
}

function QuickLinks({
  title,
  links,
  onNavigate,
}: {
  title: string
  links: Array<{ label: string; destination: string; icon: HomeIcon }>
  onNavigate: (destination: string) => void
}) {
  return (
    <section className="rounded-2xl border border-line bg-white p-6">
      <div>
        <h2 className="text-base font-bold">{title}</h2>
        <p className="mt-1 text-xs text-muted">
          Funciones disponibles para tu perfil
        </p>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {links.map((link) => (
          <button
            className="group flex items-center gap-3 rounded-xl border border-line bg-canvas/40 p-4 text-left transition hover:border-brand-soft/30 hover:bg-brand-soft/5"
            key={link.label}
            onClick={() => onNavigate(link.destination)}
            type="button"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft/10 text-brand-soft">
              <HomeIcon name={link.icon} />
            </span>
            <span className="min-w-0 flex-1 text-xs font-bold text-ink">
              {link.label}
            </span>
            <span className="text-muted transition group-hover:translate-x-0.5 group-hover:text-brand-soft">
              <HomeIcon name="arrow" />
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

function PendingActivity() {
  return (
    <section className="rounded-2xl border border-line bg-white p-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-base font-bold">Actividad y avisos</h2>
          <p className="mt-1 text-xs text-muted">
            Notificaciones, eventos y actividad institucional
          </p>
        </div>
        <StatusBadge tone="warning">Endpoint pendiente</StatusBadge>
      </div>
      <div className="mt-5 rounded-xl border border-dashed border-line bg-canvas/45 px-5 py-8 text-center">
        <p className="text-sm font-bold">Sin fuente de datos disponible</p>
        <p className="mx-auto mt-2 max-w-xl text-xs leading-5 text-muted">
          La API no expone actividad reciente, notificaciones, eventos ni
          avisos. Esta sección no presenta información ficticia.
        </p>
      </div>
    </section>
  )
}

const adminLinks = [
  { label: "Alumnos", destination: "Alumnos", icon: "people" },
  { label: "Catedráticos", destination: "Catedráticos", icon: "people" },
  { label: "Usuarios", destination: "Usuarios", icon: "people" },
  { label: "Grados y carreras", destination: "Grados y carreras", icon: "book" },
  { label: "Cursos", destination: "Cursos", icon: "book" },
  { label: "Ciclos y períodos", destination: "Ciclos y períodos", icon: "calendar" },
  { label: "Asignaciones", destination: "Asignaciones", icon: "book" },
  { label: "Horarios", destination: "Horarios docentes", icon: "calendar" },
  { label: "Evaluaciones", destination: "Evaluaciones", icon: "grade" },
  { label: "Matriz de calificaciones", destination: "Evaluaciones", icon: "grade" },
  { label: "Publicación de notas", destination: "Control de notas", icon: "grade" },
  { label: "Auditoría de notas", destination: "Control de notas", icon: "document" },
  { label: "Cargos", destination: "Cargos y solvencia", icon: "money" },
  { label: "Pagos", destination: "Pagos", icon: "money" },
  { label: "Solvencia", destination: "Cargos y solvencia", icon: "document" },
  { label: "Documentos", destination: "Documentos", icon: "document" },
  { label: "Reportes", destination: "Reportes", icon: "document" },
] satisfies Array<{ label: string; destination: string; icon: HomeIcon }>

const teacherLinks = [
  { label: "Mis cursos", destination: "Mis cursos", icon: "book" },
  { label: "Mi horario", destination: "Mi horario", icon: "calendar" },
  { label: "Mis alumnos", destination: "Mis alumnos", icon: "people" },
  { label: "Evaluaciones", destination: "Evaluaciones", icon: "grade" },
  { label: "Matriz de calificaciones", destination: "Calificaciones", icon: "grade" },
  { label: "Notas finales", destination: "Notas finales", icon: "grade" },
  { label: "Publicación de notas", destination: "Notas finales", icon: "document" },
  { label: "Auditoría", destination: "Notas finales", icon: "document" },
  { label: "Documentos académicos", destination: "Documentos académicos", icon: "document" },
  { label: "Reportes docentes", destination: "Reportes", icon: "document" },
] satisfies Array<{ label: string; destination: string; icon: HomeIcon }>

const studentLinks = [
  { label: "Mi perfil", destination: "Mi perfil", icon: "people" },
  { label: "Mis cursos", destination: "Mis cursos", icon: "book" },
  { label: "Mi horario", destination: "Mi horario", icon: "calendar" },
  { label: "Mis notas", destination: "Mis calificaciones", icon: "grade" },
  { label: "Boleta de calificaciones", destination: "Boleta académica", icon: "document" },
  { label: "Cargos y pagos", destination: "Cargos y pagos", icon: "money" },
  { label: "Historial de pagos", destination: "Cargos y pagos", icon: "money" },
  { label: "Solvencia", destination: "Cargos y pagos", icon: "document" },
  { label: "Documentos", destination: "Documentos", icon: "document" },
] satisfies Array<{ label: string; destination: string; icon: HomeIcon }>

const parentLinks = [
  { label: "Mis estudiantes", destination: "Mis estudiantes", icon: "people" },
  { label: "Cursos", destination: "Cursos", icon: "book" },
  { label: "Horarios", destination: "Horarios", icon: "calendar" },
  { label: "Calificaciones", destination: "Calificaciones", icon: "grade" },
  { label: "Boletas académicas", destination: "Boletas académicas", icon: "document" },
  { label: "Cargos y pagos", destination: "Cargos y pagos", icon: "money" },
  { label: "Solvencia", destination: "Cargos y pagos", icon: "document" },
  { label: "Documentos", destination: "Documentos", icon: "document" },
  { label: "Mi perfil", destination: "Mi perfil", icon: "people" },
] satisfies Array<{ label: string; destination: string; icon: HomeIcon }>

interface TeacherProgress {
  activeEvaluations: number
  incompleteEvaluations: number
  registeredGrades: number
  expectedGrades: number
  pendingNotes: number
}

function AdminHome({
  payload,
  onNavigate,
}: {
  payload: Extract<DashboardResponse, { rol: "admin" }>
  onNavigate: (value: string) => void
}) {
  const balances = Object.entries(payload.resumen.saldoPendientePorMoneda)
  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Alumnos activos" value={payload.resumen.alumnosActivos} detail="Perfiles habilitados" icon="people" />
        <Metric label="Catedráticos activos" value={payload.resumen.catedraticosActivos} detail="Equipo docente" icon="people" tone="blue" />
        <Metric label="Cursos activos" value={payload.resumen.cursosActivos} detail="Oferta académica" icon="book" tone="amber" />
        <Metric label="Notas publicadas" value={payload.resumen.notasPublicadas} detail="Oficialmente visibles" icon="grade" tone="violet" />
        <Metric label="Cargos pendientes" value={payload.resumen.cargosPendientes} detail="Obligaciones abiertas" icon="money" tone="amber" />
      </section>
      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <section className="rounded-2xl border border-line bg-white p-6">
          <h2 className="text-base font-bold">Saldos pendientes</h2>
          <p className="mt-1 text-xs text-muted">Separados por moneda por el backend</p>
          <div className="mt-5 space-y-3">
            {balances.length ? balances.map(([currency, amount]) => (
              <div className="flex items-center justify-between rounded-xl bg-canvas/60 px-4 py-3" key={currency}>
                <span className="text-xs font-bold text-muted">{currency}</span>
                <span className="text-lg font-bold text-brand">{formatMoney(currency, amount)}</span>
              </div>
            )) : <p className="rounded-xl border border-dashed border-line p-5 text-center text-sm text-muted">Sin saldos pendientes</p>}
          </div>
        </section>
        <QuickLinks title="Gestión institucional" links={adminLinks} onNavigate={onNavigate} />
      </div>
      <PendingActivity />
    </div>
  )
}

function TeacherHome({
  payload,
  progress,
  onNavigate,
}: {
  payload: Extract<DashboardResponse, { rol: "catedratico" }>
  progress: TeacherProgress | null
  onNavigate: (value: string) => void
}) {
  const gradeProgress = progress?.expectedGrades
    ? Math.round((progress.registeredGrades / progress.expectedGrades) * 100)
    : 0
  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Cursos asignados" value={payload.resumen.cursosAsignados} detail="En el período" icon="book" />
        <Metric label="Alumnos inscritos" value={payload.resumen.alumnosInscritos} detail="Sin duplicados" icon="people" tone="blue" />
        <Metric label="Evaluaciones activas" value={progress?.activeEvaluations ?? "—"} detail={`${progress?.incompleteEvaluations ?? 0} pendientes de completar`} icon="grade" tone="amber" />
        <Metric label="Notas por publicar" value={progress?.pendingNotes ?? "—"} detail="Consolidaciones pendientes" icon="document" tone="violet" />
      </section>
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-2xl border border-line bg-white p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-bold">Agenda semanal</h2>
              <p className="mt-1 text-xs text-muted">Bloques de horario asignados</p>
            </div>
            <StatusBadge tone="info">{payload.cursos.length} bloques</StatusBadge>
          </div>
          <div className="mt-5 space-y-3">
            {payload.cursos.length ? payload.cursos.slice(0, 5).map((course, index) => (
              <button
                className="flex w-full items-center gap-4 rounded-xl border border-line p-4 text-left transition hover:border-brand-soft/30 hover:bg-brand-soft/5"
                key={`${course.id}-${course.dia}-${index}`}
                onClick={() => onNavigate("Mi horario")}
                type="button"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-soft/10 text-brand-soft"><HomeIcon name="calendar" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">{course.nombre}</span>
                  <span className="mt-1 block text-xs text-muted">{course.dia} · {course.horaInicio.slice(0, 5)}–{course.horaFin.slice(0, 5)}</span>
                </span>
              </button>
            )) : <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">Sin clases programadas</p>}
          </div>
        </section>
        <section className="rounded-2xl border border-line bg-white p-6">
          <h2 className="text-base font-bold">Avance de calificaciones</h2>
          <p className="mt-1 text-xs text-muted">Registros de evaluaciones activas</p>
          <div className="mt-8 text-center">
            <p className="text-4xl font-bold text-brand">{gradeProgress}%</p>
            <p className="mt-2 text-sm text-muted">{progress?.registeredGrades ?? 0} de {progress?.expectedGrades ?? 0} registros</p>
            <div className="mt-5 grid grid-cols-10 gap-1" aria-label={`Avance ${gradeProgress}%`}>
              {Array.from({ length: 10 }, (_, index) => (
                <span
                  className={`h-2 rounded-full ${
                    index < Math.ceil(gradeProgress / 10)
                      ? "bg-brand-soft"
                      : "bg-line"
                  }`}
                  key={index}
                />
              ))}
            </div>
            <button className="mt-6 rounded-xl bg-brand px-4 py-2.5 text-sm font-bold text-white" onClick={() => onNavigate("Calificaciones")} type="button">Continuar calificando</button>
          </div>
        </section>
      </div>
      <QuickLinks title="Trabajo académico" links={teacherLinks} onNavigate={onNavigate} />
      <PendingActivity />
    </div>
  )
}

function StudentOverview({
  summary,
  onNavigate,
  onDownload,
  downloading,
  links = studentLinks,
}: {
  summary: StudentDashboardSummary
  onNavigate: (value: string) => void
  onDownload: (kind: "report" | "account", studentId: number) => void
  downloading: boolean
  links?: Array<{ label: string; destination: string; icon: HomeIcon }>
}) {
  const balances = Object.entries(summary.saldoPendientePorMoneda)
  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Cursos inscritos" value={summary.totalCursos} detail="Asignaciones del período" icon="book" />
        <Metric label="Promedio publicado" value={summary.promedioNotasPublicadas.toFixed(2)} detail={`${summary.totalNotasPublicadas} notas oficiales`} icon="grade" tone="blue" />
        <Metric label="Cursos aprobados" value={summary.aprobados} detail={`${summary.reprobados} reprobados`} icon="grade" tone="amber" />
        <Metric label="Cargos pendientes" value={summary.cargosPendientes.length} detail={balances.map(([currency, amount]) => formatMoney(currency, amount)).join(" · ") || "Sin saldo"} icon="money" tone="violet" />
      </section>
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-2xl border border-line bg-white p-6">
          <h2 className="text-base font-bold">Mis cursos</h2>
          <p className="mt-1 text-xs text-muted">Cursos inscritos en el período</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {summary.cursos.length ? summary.cursos.map((course) => (
              <button className="rounded-xl border border-line p-4 text-left hover:border-brand-soft/30 hover:bg-brand-soft/5" key={course.id} onClick={() => onNavigate("Mis cursos")} type="button">
                <span className="font-mono text-xs font-bold text-brand-soft">{course.codigo}</span>
                <span className="mt-2 block text-sm font-bold">{course.nombre}</span>
                <span className="mt-1 block text-xs text-muted">{course.gradoCarrera?.nombre ?? "Curso inscrito"}</span>
              </button>
            )) : <p className="text-sm text-muted">No hay cursos inscritos en este período.</p>}
          </div>
        </section>
        <section className="rounded-2xl border border-line bg-white p-6">
          <h2 className="text-base font-bold">Documentos y saldos</h2>
          <p className="mt-1 text-xs text-muted">Documentos oficiales disponibles</p>
          <div className="mt-5 space-y-3">
            <button className="flex w-full items-center gap-3 rounded-xl border border-line p-4 text-left hover:bg-canvas" disabled={downloading} onClick={() => onDownload("report", summary.alumno.id)} type="button"><span className="text-brand-soft"><HomeIcon name="document" /></span><span className="text-sm font-bold">Boleta de calificaciones</span></button>
            <button className="flex w-full items-center gap-3 rounded-xl border border-line p-4 text-left hover:bg-canvas" disabled={downloading} onClick={() => onDownload("account", summary.alumno.id)} type="button"><span className="text-brand-soft"><HomeIcon name="document" /></span><span className="text-sm font-bold">Estado de cuenta</span></button>
            <button className="flex w-full items-center gap-3 rounded-xl border border-line p-4 text-left hover:bg-canvas" onClick={() => onNavigate("Cargos y pagos")} type="button"><span className="text-brand-soft"><HomeIcon name="money" /></span><span className="text-sm font-bold">Consultar solvencia</span></button>
          </div>
        </section>
      </div>
      <QuickLinks title="Mi portal académico" links={links} onNavigate={onNavigate} />
      <PendingActivity />
    </div>
  )
}

export default function RoleDashboardHome({
  user,
  payload,
  loading,
  onNavigate,
}: {
  user: AuthUser
  payload: DashboardResponse | null
  loading: boolean
  onNavigate: (destination: string) => void
}) {
  const { selectedPeriodId } = useAcademicPeriod()
  const [teacherProgress, setTeacherProgress] = useState<TeacherProgress | null>(null)
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null)
  const [studentSchedules, setStudentSchedules] = useState<HorarioCatedratico[]>([])
  const [supplementalLoading, setSupplementalLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState("")

  const parentPayload = payload?.rol === "padre" ? payload : null
  const selectedStudent = useMemo(
    () =>
      parentPayload?.alumnos.find(
        (item) => item.alumno.id === selectedStudentId,
      ) ?? parentPayload?.alumnos[0],
    [parentPayload, selectedStudentId],
  )

  useEffect(() => {
    if (!parentPayload?.alumnos.length) {
      setSelectedStudentId(null)
      return
    }
    if (
      !parentPayload.alumnos.some(
        (item) => item.alumno.id === selectedStudentId,
      )
    ) {
      setSelectedStudentId(parentPayload.alumnos[0].alumno.id)
    }
  }, [parentPayload, selectedStudentId])

  const loadTeacherProgress = useCallback(async () => {
    if (payload?.rol !== "catedratico") return
    setSupplementalLoading(true)
    setError("")
    try {
      const [evaluations, notes, assignments] = await Promise.all([
        evaluationsService.list({
          periodoAcademicoId: selectedPeriodId ?? undefined,
        }),
        notesService.list({
          periodoAcademicoId: selectedPeriodId ?? undefined,
        }),
        academicAssignmentsService.listAssignments({
          periodoAcademicoId: selectedPeriodId ?? undefined,
        }),
      ])
      const active = evaluations.filter((item) => item.activo)
      const gradeRows = await Promise.all(
        active.map((item) => evaluationsService.listGrades(item.id)),
      )
      let expectedGrades = 0
      let registeredGrades = 0
      let incompleteEvaluations = 0
      active.forEach((evaluation: Evaluacion, index) => {
        const enrolled = assignments.filter(
          (item) => item.cursoId === evaluation.cursoId,
        ).length
        const registered = gradeRows[index].length
        expectedGrades += enrolled
        registeredGrades += registered
        if (registered < enrolled) incompleteEvaluations += 1
      })
      setTeacherProgress({
        activeEvaluations: active.length,
        incompleteEvaluations,
        registeredGrades,
        expectedGrades,
        pendingNotes: notes.filter((note) => !note.publicadaEn).length,
      })
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible completar los indicadores docentes.",
      )
    } finally {
      setSupplementalLoading(false)
    }
  }, [payload, selectedPeriodId])

  useEffect(() => {
    loadTeacherProgress()
  }, [loadTeacherProgress])

  useEffect(() => {
    if (payload?.rol !== "padre" || !selectedStudent?.alumno.id) return
    let active = true
    setSupplementalLoading(true)
    setStudentSchedules([])
    setError("")
    academicAssignmentsService
      .listSchedules({
        alumnoId: selectedStudent.alumno.id,
        periodoAcademicoId: selectedPeriodId ?? undefined,
      })
      .then((rows) => {
        if (active) setStudentSchedules(rows)
      })
      .catch((requestError) => {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "No fue posible consultar el horario del estudiante.",
          )
        }
      })
      .finally(() => {
        if (active) setSupplementalLoading(false)
      })
    return () => {
      active = false
    }
  }, [payload?.rol, selectedStudent, selectedPeriodId])

  async function download(kind: "report" | "account", studentId: number) {
    setDownloading(true)
    setError("")
    try {
      const blob =
        kind === "report"
          ? await notesService.downloadReportCard(studentId, {
              periodoAcademicoId: selectedPeriodId ?? undefined,
            })
          : await financeService.downloadAccountStatement(studentId, {
              periodoAcademicoId: selectedPeriodId ?? undefined,
            })
      downloadBlob(
        blob,
        kind === "report"
          ? `boleta-alumno-${studentId}.pdf`
          : `estado-cuenta-alumno-${studentId}.pdf`,
      )
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible descargar el documento.",
      )
    } finally {
      setDownloading(false)
    }
  }

  if (loading || !payload) return <LoadingState rows={6} />

  return (
    <>
      {error && (
        <div className="mb-6">
          <ErrorState
            message={error}
            onRetry={
              user.rol === "catedratico" ? loadTeacherProgress : undefined
            }
          />
        </div>
      )}
      {payload.rol === "admin" && (
        <AdminHome onNavigate={onNavigate} payload={payload} />
      )}
      {payload.rol === "catedratico" && (
        <TeacherHome
          onNavigate={onNavigate}
          payload={payload}
          progress={supplementalLoading ? null : teacherProgress}
        />
      )}
      {payload.rol === "alumno" && (
        <StudentOverview
          downloading={downloading}
          onDownload={download}
          onNavigate={onNavigate}
          summary={payload}
        />
      )}
      {payload.rol === "padre" && (
        <div className="space-y-6">
          <section className="flex flex-col justify-between gap-4 rounded-2xl border border-line bg-white p-5 sm:flex-row sm:items-center sm:p-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-brand-soft">
                Seguimiento familiar
              </p>
              <h2 className="mt-1 text-lg font-bold">
                {selectedStudent
                  ? `${selectedStudent.alumno.nombre} ${selectedStudent.alumno.apellido}`
                  : "Sin estudiantes vinculados"}
              </h2>
              <p className="mt-1 text-xs text-muted">
                La selección solo contiene vínculos autorizados por el backend.
              </p>
            </div>
            <SelectInput
              aria-label="Seleccionar estudiante vinculado"
              className="sm:max-w-72"
              onChange={(event) =>
                setSelectedStudentId(Number(event.target.value))
              }
              value={selectedStudent?.alumno.id ?? ""}
            >
              {payload.alumnos.map((item) => (
                <option key={item.alumno.id} value={item.alumno.id}>
                  {item.alumno.nombre} {item.alumno.apellido}
                </option>
              ))}
            </SelectInput>
          </section>
          {selectedStudent ? (
            <>
              <StudentOverview
                downloading={downloading}
                links={parentLinks}
                onDownload={download}
                onNavigate={onNavigate}
                summary={selectedStudent}
              />
              <section className="rounded-2xl border border-line bg-white p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-base font-bold">Horario del estudiante</h2>
                    <p className="mt-1 text-xs text-muted">
                      Bloques visibles del período seleccionado
                    </p>
                  </div>
                  <StatusBadge tone="info">
                    {studentSchedules.length} bloques
                  </StatusBadge>
                </div>
                {supplementalLoading ? (
                  <LoadingState rows={3} />
                ) : studentSchedules.length ? (
                  <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {studentSchedules.map((schedule) => (
                      <div className="rounded-xl border border-line p-4" key={schedule.id}>
                        <p className="text-sm font-bold">
                          {schedule.curso?.nombre ??
                            `Curso ID ${schedule.cursoId}`}
                        </p>
                        <p className="mt-2 text-xs font-semibold text-brand-soft">
                          {schedule.dia} · {schedule.horaInicio.slice(0, 5)}–
                          {schedule.horaFin.slice(0, 5)}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          {schedule.catedratico
                            ? `${schedule.catedratico.nombre} ${schedule.catedratico.apellido}`
                            : "Catedrático no disponible"}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-5 rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
                    Sin horario visible para este estudiante.
                  </p>
                )}
              </section>
            </>
          ) : (
            <section className="rounded-2xl border border-line bg-white p-8 text-center text-sm text-muted">
              No hay estudiantes vinculados a esta cuenta.
            </section>
          )}
        </div>
      )}
    </>
  )
}
