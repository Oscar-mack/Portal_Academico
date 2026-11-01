import { useCallback, useEffect, useMemo, useState } from "react"
import AdminPage from "../components/AdminPage"
import ConfirmDialog from "../components/ConfirmDialog"
import DataTable from "../components/DataTable"
import EmptyState from "../components/EmptyState"
import ErrorState from "../components/ErrorState"
import FilterBar from "../components/FilterBar"
import { SelectInput } from "../components/FormField"
import LoadingState from "../components/LoadingState"
import Modal from "../components/Modal"
import StatusBadge from "../components/StatusBadge"
import { useAcademicPeriod } from "../context/AcademicPeriodContext"
import type { AuthUser } from "../lib/api"
import { downloadBlob } from "../lib/download"
import { catalogsService } from "../services/catalogsService"
import {
  catedraticosService,
  type Catedratico as TeacherRecord,
} from "../services/catedraticosService"
import { dashboardService } from "../services/dashboardService"
import { evaluationsService } from "../services/evaluationsService"
import { familyService } from "../services/familyService"
import { notesService } from "../services/notesService"
import type {
  Alumno,
  AuditoriaNota,
  CalificacionEvaluacion,
  Curso,
  Evaluacion,
  Nota,
} from "../types/api"
import { Notice } from "./admin/GradosCarrerasPage"

interface NoteDetail {
  note: Nota
  evaluations: Array<{
    evaluation: Evaluacion
    grade?: CalificacionEvaluacion
  }>
}

function fullName(person?: { nombre: string; apellido: string }) {
  return person ? `${person.nombre} ${person.apellido}` : "Sin información"
}

function formatDate(value?: string | null) {
  if (!value) return "Pendiente"
  return new Intl.DateTimeFormat("es-GT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

export default function NotesPage({ user }: { user: AuthUser }) {
  const { periods, selectedPeriodId, selectedPeriod } = useAcademicPeriod()
  const canManage = user.rol === "admin" || user.rol === "catedratico"
  const [items, setItems] = useState<Nota[]>([])
  const [courses, setCourses] = useState<Curso[]>([])
  const [students, setStudents] = useState<Alumno[]>([])
  const [teachers, setTeachers] = useState<TeacherRecord[]>([])
  const [catalogWarning, setCatalogWarning] = useState("")
  const [query, setQuery] = useState("")
  const [courseFilter, setCourseFilter] = useState("")
  const [studentFilter, setStudentFilter] = useState("")
  const [teacherFilter, setTeacherFilter] = useState("")
  const [publicationFilter, setPublicationFilter] = useState("")
  const [serverAverage, setServerAverage] = useState<number | null>(null)
  const [publishing, setPublishing] = useState<Nota | null>(null)
  const [historyNote, setHistoryNote] = useState<Nota | null>(null)
  const [history, setHistory] = useState<AuditoriaNota[]>([])
  const [detail, setDetail] = useState<NoteDetail | null>(null)
  const [secondaryLoading, setSecondaryLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    setCatalogWarning("")
    try {
      const noteRows = await notesService.list({
        periodoAcademicoId: selectedPeriodId ?? undefined,
      })
      const safeRows =
        user.rol === "alumno" || user.rol === "padre"
          ? noteRows.filter((note) => Boolean(note.publicadaEn))
          : noteRows
      setItems(safeRows)

      if (user.rol === "admin") {
        // Las notas ya se cargaron: un fallo en los catálogos de filtros no debe ocultarlas.
        const [courseResult, studentResult, teacherResult] = await Promise.allSettled([
          catalogsService.listCourses(true),
          catalogsService.listStudents({ incluirInactivos: true }),
          catedraticosService.list(),
        ])
        setCourses(courseResult.status === "fulfilled" ? courseResult.value : [])
        setStudents(studentResult.status === "fulfilled" ? studentResult.value : [])
        setTeachers(teacherResult.status === "fulfilled" ? teacherResult.value : [])
        const failed = [
          courseResult.status === "rejected" ? "cursos" : "",
          studentResult.status === "rejected" ? "estudiantes" : "",
          teacherResult.status === "rejected" ? "catedráticos" : "",
        ].filter(Boolean)
        if (failed.length) {
          setCatalogWarning(
            `Las notas se cargaron, pero no fue posible consultar los filtros de ${failed.join(", ")}.`,
          )
        }
      } else {
        setCourses(
          Array.from(
            new Map(
              safeRows
                .filter((note) => note.curso)
                .map((note) => [note.cursoId, note.curso as Curso]),
            ).values(),
          ),
        )
        if (user.rol === "padre") {
          const linked = await familyService.getMyStudents()
          setStudents(linked.map((item) => item.alumno))
        } else {
          setStudents(
            Array.from(
              new Map(
                safeRows
                  .filter((note) => note.alumno)
                  .map((note) => [note.alumnoId, note.alumno as Alumno]),
              ).values(),
            ),
          )
        }
      }

      if (user.rol === "alumno" || user.rol === "padre") {
        const summary = await dashboardService.get(selectedPeriodId)
        if (summary.rol === "alumno") {
          setServerAverage(summary.promedioNotasPublicadas)
        } else if (summary.rol === "padre" && studentFilter) {
          setServerAverage(
            summary.alumnos.find(
              (item) => item.alumno.id === Number(studentFilter),
            )?.promedioNotasPublicadas ?? null,
          )
        } else {
          setServerAverage(null)
        }
      } else {
        setServerAverage(null)
      }
    } catch (requestError) {
      setItems([])
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible consultar las notas.",
      )
    } finally {
      setLoading(false)
    }
  }, [selectedPeriodId, studentFilter, user.rol])

  useEffect(() => {
    load()
  }, [load])

  const visibleItems = useMemo(() => {
    const term = query.toLowerCase().trim()
    return items.filter((note) => {
      const student =
        note.alumno ?? students.find((item) => item.id === note.alumnoId)
      const course =
        note.curso ?? courses.find((item) => item.id === note.cursoId)
      return (
        (!courseFilter || note.cursoId === Number(courseFilter)) &&
        (!studentFilter || note.alumnoId === Number(studentFilter)) &&
        (!teacherFilter ||
          note.catedraticoId === Number(teacherFilter)) &&
        (!publicationFilter ||
          (publicationFilter === "published"
            ? Boolean(note.publicadaEn)
            : !note.publicadaEn)) &&
        (!term ||
          fullName(student).toLowerCase().includes(term) ||
          course?.nombre.toLowerCase().includes(term) ||
          course?.codigo.toLowerCase().includes(term) ||
          String(note.alumnoId).includes(term))
      )
    })
  }, [
    items,
    query,
    courseFilter,
    studentFilter,
    teacherFilter,
    publicationFilter,
    students,
    courses,
  ])

  async function publish() {
    if (!publishing) return
    setSaving(true)
    setError("")
    try {
      await notesService.publish(publishing.id)
      setNotice("La nota fue publicada y ya puede ser consultada como oficial.")
      setPublishing(null)
      await load()
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible publicar la nota.",
      )
      setPublishing(null)
    } finally {
      setSaving(false)
    }
  }

  async function openHistory(note: Nota) {
    setHistoryNote(note)
    setHistory([])
    setSecondaryLoading(true)
    setError("")
    try {
      setHistory(await notesService.history(note.id))
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible consultar el historial.",
      )
    } finally {
      setSecondaryLoading(false)
    }
  }

  async function openDetail(note: Nota) {
    setSecondaryLoading(true)
    setError("")
    try {
      if (!note.periodoAcademicoId) {
        setDetail({ note, evaluations: [] })
        return
      }
      const evaluations = await evaluationsService.list({
        cursoId: note.cursoId,
        periodoAcademicoId: note.periodoAcademicoId,
      })
      const gradeGroups = await Promise.all(
        evaluations.map((evaluation) =>
          evaluationsService.listGrades(evaluation.id),
        ),
      )
      setDetail({
        note,
        evaluations: evaluations.map((evaluation, index) => ({
          evaluation,
          grade: gradeGroups[index].find(
            (grade) => grade.alumnoId === note.alumnoId,
          ),
        })),
      })
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible consultar el detalle de consolidación.",
      )
    } finally {
      setSecondaryLoading(false)
    }
  }

  async function downloadReportCard(studentId: number) {
    setDownloading(true)
    setError("")
    try {
      const blob = await notesService.downloadReportCard(studentId, {
        periodoAcademicoId: selectedPeriodId ?? undefined,
      })
      downloadBlob(blob, `boleta-alumno-${studentId}.pdf`)
      setNotice("La boleta oficial se descargó correctamente.")
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible descargar la boleta.",
      )
    } finally {
      setDownloading(false)
    }
  }

  const reportStudentId =
    Number(studentFilter) ||
    Number(user.alumnoId) ||
    (students.length === 1 ? students[0].id : 0)
  const publishedCount = visibleItems.filter((note) => note.publicadaEn).length
  const pendingCount = visibleItems.length - publishedCount
  const visibleTeachers = Array.from(
    new Map<number, { id: number; nombre: string; apellido: string }>([
      ...teachers.map((teacher) => [teacher.id, teacher] as const),
      ...items
        .filter((note) => note.catedratico)
        .map((note) => [note.catedraticoId, note.catedratico!] as const),
    ]).values(),
  )

  return (
    <>
      <AdminPage
        action={
          reportStudentId ? (
            <button
              className="h-11 rounded-xl border border-brand-soft/25 bg-white px-4 text-sm font-bold text-brand-soft hover:bg-brand-soft/5 disabled:opacity-50"
              disabled={downloading}
              onClick={() => downloadReportCard(reportStudentId)}
              type="button"
            >
              {downloading ? "Descargando..." : "Descargar boleta PDF"}
            </button>
          ) : undefined
        }
        count={
          loading
            ? "Consultando notas..."
            : `${visibleItems.length} notas · ${publishedCount} publicadas · ${pendingCount} pendientes`
        }
        description="Consulta notas finales consolidadas y su estado oficial."
        title={
          user.rol === "alumno" || user.rol === "padre"
            ? "Calificaciones oficiales"
            : "Notas finales y publicación"
        }
      >
        {(user.rol === "alumno" || user.rol === "padre") && (
          <div className="grid gap-3 border-b border-line bg-brand-soft/5 px-5 py-4 sm:grid-cols-2 sm:px-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted">
                Promedio publicado
              </p>
              <p className="mt-1 text-2xl font-bold text-brand">
                {serverAverage === null ? "—" : serverAverage.toFixed(2)}
              </p>
            </div>
            <p className="self-center text-xs leading-5 text-muted">
              Solo se muestran notas publicadas. El promedio proviene del
              dashboard calculado por el backend.
            </p>
          </div>
        )}
        <FilterBar
          onSearchChange={setQuery}
          placeholder="Buscar estudiante, ID, curso o código..."
          search={query}
        >
          <SelectInput
            aria-label="Filtrar por curso"
            className="sm:max-w-52"
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
          {(user.rol === "admin" || user.rol === "padre") && (
            <SelectInput
              aria-label="Filtrar por estudiante"
              className="sm:max-w-52"
              onChange={(event) => setStudentFilter(event.target.value)}
              value={studentFilter}
            >
              <option value="">Todos los estudiantes</option>
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {fullName(student)}
                </option>
              ))}
            </SelectInput>
          )}
          {user.rol === "admin" && (
            <SelectInput
              aria-label="Filtrar por catedrático"
              className="sm:max-w-52"
              onChange={(event) => setTeacherFilter(event.target.value)}
              value={teacherFilter}
            >
              <option value="">Todos los catedráticos</option>
              {visibleTeachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {fullName(teacher)}
                </option>
              ))}
            </SelectInput>
          )}
          {canManage && (
            <SelectInput
              aria-label="Filtrar por publicación"
              className="sm:max-w-44"
              onChange={(event) => setPublicationFilter(event.target.value)}
              value={publicationFilter}
            >
              <option value="">Cualquier publicación</option>
              <option value="pending">Pendientes</option>
              <option value="published">Publicadas</option>
            </SelectInput>
          )}
        </FilterBar>
        {notice && <Notice message={notice} onClose={() => setNotice("")} />}
        {catalogWarning && (
          <p className="mx-5 mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:mx-6">
            {catalogWarning}
          </p>
        )}
        {error && !historyNote && !detail && (
          <div className="mx-5 mt-5 sm:mx-6">
            <ErrorState message={error} onRetry={load} />
          </div>
        )}
        {loading ? (
          <LoadingState rows={5} />
        ) : error && !items.length ? null : visibleItems.length ? (
          <DataTable minWidth="min-w-[72rem]">
            <thead>
              <tr className="border-b border-line bg-canvas/45 text-[0.68rem] font-bold uppercase tracking-wider text-muted">
                <th className="px-6 py-3.5">Estudiante</th>
                <th className="px-4 py-3.5">Curso</th>
                <th className="px-4 py-3.5">Período</th>
                <th className="px-4 py-3.5">Nota final</th>
                <th className="px-4 py-3.5">Resultado</th>
                <th className="px-4 py-3.5">Publicación</th>
                <th className="px-6 py-3.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visibleItems.map((note) => {
                const student =
                  note.alumno ??
                  students.find((item) => item.id === note.alumnoId)
                const course =
                  note.curso ??
                  courses.find((item) => item.id === note.cursoId)
                return (
                  <tr className="hover:bg-canvas/40" key={note.id}>
                    <td className="px-6 py-4">
                      <p className="text-sm font-bold">{fullName(student)}</p>
                      <p className="mt-1 text-xs text-muted">
                        ID {note.alumnoId}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <p className="text-sm font-bold">
                        {course?.nombre ?? `Curso ID ${note.cursoId}`}
                      </p>
                      <p className="mt-1 font-mono text-xs text-brand-soft">
                        {course?.codigo}
                      </p>
                    </td>
                    <td className="px-4 py-4 text-sm text-muted">
                      {periods.find(
                        (period) => period.id === note.periodoAcademicoId,
                      )?.nombre ||
                        note.periodo ||
                        "Histórico"}
                    </td>
                    <td className="px-4 py-4 text-xl font-bold text-brand">
                      {Number(note.valor).toFixed(2)}
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge
                        tone={note.estado === "aprobado" ? "success" : "danger"}
                      >
                        {note.estado === "aprobado"
                          ? "Aprobado"
                          : "Reprobado"}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge tone={note.publicadaEn ? "info" : "warning"}>
                        {note.publicadaEn
                          ? formatDate(note.publicadaEn)
                          : "Pendiente"}
                      </StatusBadge>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-2">
                        {canManage && note.periodoAcademicoId && (
                          <button
                            className="rounded-lg border border-line px-3 py-2 text-xs font-bold text-muted hover:bg-canvas"
                            onClick={() => openDetail(note)}
                            type="button"
                          >
                            Desglose
                          </button>
                        )}
                        {canManage && (
                          <button
                            className="rounded-lg border border-line px-3 py-2 text-xs font-bold text-muted hover:bg-canvas"
                            onClick={() => openHistory(note)}
                            type="button"
                          >
                            Historial
                          </button>
                        )}
                        {canManage && !note.publicadaEn && (
                          <button
                            className="rounded-lg bg-brand px-3 py-2 text-xs font-bold text-white"
                            onClick={() => setPublishing(note)}
                            type="button"
                          >
                            Publicar
                          </button>
                        )}
                        {!canManage && (
                          <button
                            className="rounded-lg border border-brand-soft/25 px-3 py-2 text-xs font-bold text-brand-soft hover:bg-brand-soft/5"
                            onClick={() => downloadReportCard(note.alumnoId)}
                            type="button"
                          >
                            Boleta
                          </button>
                        )}
                      </div>
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
                ? `No hay notas visibles en ${selectedPeriod.nombre}.`
                : "No hay notas visibles con los filtros actuales."
            }
            title="Sin notas"
          />
        )}
      </AdminPage>

      <ConfirmDialog
        confirmLabel="Publicar nota"
        confirming={saving}
        confirmingLabel="Publicando..."
        message="La nota será visible como oficial para el alumno y sus padres o tutores. El servidor verificará que la consolidación esté completa."
        onCancel={() => setPublishing(null)}
        onConfirm={publish}
        open={Boolean(publishing)}
        title="¿Publicar esta nota?"
        tone="brand"
      />

      <Modal
        description="La auditoría es de solo lectura y se presenta en orden cronológico."
        onClose={() => {
          setHistoryNote(null)
          setError("")
        }}
        open={Boolean(historyNote)}
        title="Historial de modificaciones"
      >
        <div className="px-6 py-6">
          {historyNote && (
            <div className="mb-5 rounded-xl bg-canvas/60 p-4">
              <p className="text-sm font-bold">
                {fullName(historyNote.alumno)} ·{" "}
                {historyNote.curso?.nombre ??
                  `Curso ID ${historyNote.cursoId}`}
              </p>
              <p className="mt-1 text-xs text-muted">
                Nota actual: {historyNote.valor} ·{" "}
                {historyNote.publicadaEn ? "publicada" : "pendiente"}
              </p>
            </div>
          )}
          {secondaryLoading ? (
            <LoadingState rows={3} />
          ) : error ? (
            <ErrorState
              message={error}
              onRetry={() => historyNote && openHistory(historyNote)}
            />
          ) : history.length ? (
            <div className="relative space-y-4 border-l-2 border-line pl-5">
              {history.map((entry) => (
                <article
                  className="relative rounded-xl border border-line bg-white p-4"
                  key={entry.id}
                >
                  <span className="absolute top-5 -left-[1.7rem] size-3 rounded-full border-2 border-white bg-brand-soft" />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-bold">
                      {entry.valorAnterior ?? "—"} → {entry.valorNuevo}
                    </p>
                    <p className="text-xs text-muted">
                      {formatDate(entry.createdAt)}
                    </p>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted">
                    {entry.motivo || "Cambio sin motivo requerido"}
                  </p>
                  <p className="mt-2 text-xs font-semibold text-brand-soft">
                    Usuario ID {entry.usuarioId}
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              description="Esta nota todavía no tiene modificaciones auditadas."
              title="Sin historial"
            />
          )}
        </div>
      </Modal>

      <Modal
        description="El valor final mostrado es el consolidado por el servidor."
        onClose={() => {
          setDetail(null)
          setError("")
        }}
        open={Boolean(detail)}
        title="Desglose de la nota final"
      >
        <div className="px-6 py-6">
          {detail && (
            <>
              <div className="mb-5 flex items-center justify-between rounded-xl bg-canvas/60 p-4">
                <div>
                  <p className="text-sm font-bold">
                    {fullName(detail.note.alumno)}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {detail.note.curso?.nombre}
                  </p>
                </div>
                <p className="text-2xl font-bold text-brand">
                  {Number(detail.note.valor).toFixed(2)}
                </p>
              </div>
              <div className="divide-y divide-line rounded-xl border border-line">
                {detail.evaluations.map(({ evaluation, grade }) => (
                  <div
                    className="flex items-center justify-between gap-4 px-4 py-3"
                    key={evaluation.id}
                  >
                    <div>
                      <p className="text-sm font-bold">{evaluation.nombre}</p>
                      <p className="mt-1 text-xs text-muted">
                        Máximo {Number(evaluation.puntajeMaximo)}
                      </p>
                    </div>
                    <StatusBadge tone={grade ? "success" : "warning"}>
                      {grade
                        ? `${Number(grade.valor)} / ${Number(evaluation.puntajeMaximo)}`
                        : "Sin registro"}
                    </StatusBadge>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  )
}
