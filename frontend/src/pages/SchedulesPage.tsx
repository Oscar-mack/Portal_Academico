import { FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import AdminPage from "../components/AdminPage"
import DataTable from "../components/DataTable"
import EmptyState from "../components/EmptyState"
import ErrorState from "../components/ErrorState"
import FilterBar from "../components/FilterBar"
import { FormField, SelectInput, TextInput } from "../components/FormField"
import LoadingState from "../components/LoadingState"
import Modal from "../components/Modal"
import { useAcademicPeriod } from "../context/AcademicPeriodContext"
import type { AuthUser } from "../lib/api"
import {
  academicAssignmentsService,
  type ScheduleInput,
} from "../services/academicAssignmentsService"
import { catalogsService } from "../services/catalogsService"
import {
  catedraticosService,
  type Catedratico as TeacherRecord,
} from "../services/catedraticosService"
import type {
  AsignacionCurso,
  Curso,
  HorarioCatedratico,
  WeekDay,
} from "../types/api"
import { FormActions, Notice } from "./admin/GradosCarrerasPage"

const DAYS: WeekDay[] = [
  "Lunes",
  "Martes",
  "Miercoles",
  "Jueves",
  "Viernes",
  "Sabado",
]

const DAY_LABELS: Record<WeekDay, string> = {
  Lunes: "Lunes",
  Martes: "Martes",
  Miercoles: "Miércoles",
  Jueves: "Jueves",
  Viernes: "Viernes",
  Sabado: "Sábado",
}

function fullName(person?: { nombre: string; apellido: string }) {
  return person ? `${person.nombre} ${person.apellido}` : "Sin información"
}

function shortTime(value: string) {
  return value.slice(0, 5)
}

function schedulePeriodKey(schedule: HorarioCatedratico) {
  return schedule.periodoAcademicoId
    ? `id:${schedule.periodoAcademicoId}`
    : `legacy:${schedule.periodo}`
}

export default function SchedulesPage({ user }: { user: AuthUser }) {
  const { periods, selectedPeriodId, selectedPeriod } = useAcademicPeriod()
  const canManage = user.rol === "admin"
  const [items, setItems] = useState<HorarioCatedratico[]>([])
  const [courses, setCourses] = useState<Curso[]>([])
  const [teachers, setTeachers] = useState<TeacherRecord[]>([])
  const [offers, setOffers] = useState<
    Awaited<ReturnType<typeof academicAssignmentsService.listCourseOffers>>
  >([])
  const [selectedOfferId, setSelectedOfferId] = useState("")
  const [query, setQuery] = useState("")
  const [courseFilter, setCourseFilter] = useState("")
  const [teacherFilter, setTeacherFilter] = useState("")
  const [dayFilter, setDayFilter] = useState("")
  const [view, setView] = useState<"week" | "table">("week")
  const [editor, setEditor] = useState<HorarioCatedratico | "create" | null>(null)
  const [detail, setDetail] = useState<HorarioCatedratico | null>(null)
  const [detailAssignments, setDetailAssignments] = useState<AsignacionCurso[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [catalogErrors, setCatalogErrors] = useState<{
    courses?: string
    teachers?: string
    offers?: string
  }>({})
  const [notice, setNotice] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const scheduleRows = await academicAssignmentsService.listSchedules({
        periodoAcademicoId: selectedPeriodId ?? undefined,
      })
      setItems(scheduleRows)
      if (canManage) {
        // Los catálogos se consultan por separado: si uno falla, los demás siguen disponibles.
        const [courseResult, teacherResult, offerResult] = await Promise.allSettled([
          catalogsService.listCourses(true),
          catedraticosService.list(),
          academicAssignmentsService.listCourseOffers(selectedPeriodId ?? undefined),
        ])
        const reason = (result: PromiseRejectedResult, fallback: string) =>
          result.reason instanceof Error ? result.reason.message : fallback
        setCourses(courseResult.status === "fulfilled" ? courseResult.value : [])
        setTeachers(teacherResult.status === "fulfilled" ? teacherResult.value : [])
        setOffers(offerResult.status === "fulfilled" ? offerResult.value : [])
        setCatalogErrors({
          courses:
            courseResult.status === "rejected"
              ? reason(courseResult, "No fue posible consultar los cursos.")
              : undefined,
          teachers:
            teacherResult.status === "rejected"
              ? reason(teacherResult, "No fue posible consultar los catedráticos.")
              : undefined,
          offers:
            offerResult.status === "rejected"
              ? reason(offerResult, "No fue posible consultar las secciones.")
              : undefined,
        })
      } else {
        setCatalogErrors({})
        setOffers([])
        setCourses(
          Array.from(
            new Map(
              scheduleRows
                .filter((schedule) => schedule.curso)
                .map((schedule) => [schedule.cursoId, schedule.curso as Curso]),
            ).values(),
          ),
        )
        setTeachers(
          Array.from(
            new Map(
              scheduleRows
                .filter((schedule) => schedule.catedratico)
                .map((schedule) => [
                  schedule.catedraticoId,
                  schedule.catedratico as TeacherRecord,
                ]),
            ).values(),
          ),
        )
      }
    } catch (requestError) {
      setItems([])
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible consultar los horarios.",
      )
    } finally {
      setLoading(false)
    }
  }, [canManage, selectedPeriodId])

  useEffect(() => {
    load()
  }, [load])

  const visibleItems = useMemo(() => {
    const term = query.toLowerCase().trim()
    return [...items]
      .filter((schedule) => {
        const course =
          schedule.curso ??
          courses.find((candidate) => candidate.id === schedule.cursoId)
        const teacher =
          schedule.catedratico ??
          teachers.find(
            (candidate) => candidate.id === schedule.catedraticoId,
          )
        return (
          (!courseFilter || schedule.cursoId === Number(courseFilter)) &&
          (!teacherFilter ||
            schedule.catedraticoId === Number(teacherFilter)) &&
          (!dayFilter || schedule.dia === dayFilter) &&
          (!term ||
            course?.nombre.toLowerCase().includes(term) ||
            course?.codigo.toLowerCase().includes(term) ||
            fullName(teacher).toLowerCase().includes(term))
        )
      })
      .sort(
        (left, right) =>
          DAYS.indexOf(left.dia) - DAYS.indexOf(right.dia) ||
          left.horaInicio.localeCompare(right.horaInicio),
      )
  }, [
    items,
    query,
    courseFilter,
    teacherFilter,
    dayFilter,
    courses,
    teachers,
  ])

  async function openDetail(schedule: HorarioCatedratico) {
    setDetail(schedule)
    setDetailAssignments([])
    setDetailError("")
    setDetailLoading(true)
    try {
      const assignments =
        await academicAssignmentsService.listAssignments({
          cursoId: schedule.cursoId,
          ...(schedule.periodoAcademicoId
            ? { periodoAcademicoId: schedule.periodoAcademicoId }
            : { periodo: schedule.periodo }),
        })
      setDetailAssignments(assignments)
    } catch (requestError) {
      setDetailError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible consultar los estudiantes del curso.",
      )
    } finally {
      setDetailLoading(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const record = editor === "create" ? null : editor
    const dia = String(form.get("dia")) as WeekDay
    const horaInicio = String(form.get("horaInicio"))
    const horaFin = String(form.get("horaFin"))

    if (horaInicio >= horaFin) {
      setError("La hora final debe ser posterior a la hora inicial.")
      return
    }

    const selectedOffer = !record
      ? offers.find((offer) => offer.id === Number(form.get("ofertaCursoId")))
      : undefined
    const catedraticoId = record
      ? record.catedraticoId
      : selectedOffer?.catedraticoId ?? Number(form.get("catedraticoId"))
    const periodValue = record
      ? schedulePeriodKey(record)
      : `id:${selectedOffer?.periodoAcademicoId ?? String(form.get("periodoAcademicoId"))}`
    const overlap = items.some(
      (schedule) =>
        schedule.id !== record?.id &&
        schedule.catedraticoId === catedraticoId &&
        schedule.dia === dia &&
        schedulePeriodKey(schedule) === periodValue &&
        horaInicio < schedule.horaFin &&
        horaFin > schedule.horaInicio,
    )
    if (overlap) {
      setError(
        "Este bloque se cruza con otro horario del catedrático en el período seleccionado.",
      )
      return
    }

    setSaving(true)
    setError("")
    try {
      if (record) {
        await academicAssignmentsService.updateSchedule(record.id, {
          dia,
          horaInicio,
          horaFin,
        })
        setNotice("El bloque de horario se actualizó correctamente.")
      } else {
        const input: ScheduleInput = {
          catedraticoId,
          cursoId: selectedOffer?.cursoId ?? Number(form.get("cursoId")),
          periodoAcademicoId: selectedOffer?.periodoAcademicoId ?? Number(form.get("periodoAcademicoId")),
          ...(selectedOffer ? { ofertaCursoId: selectedOffer.id } : {}),
          dia,
          horaInicio,
          horaFin,
        }
        await academicAssignmentsService.createSchedule(input)
        setNotice("El bloque de horario se creó correctamente.")
      }
      setEditor(null)
      await load()
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible guardar el horario.",
      )
    } finally {
      setSaving(false)
    }
  }

  function courseFor(schedule: HorarioCatedratico) {
    return (
      schedule.curso ??
      courses.find((course) => course.id === schedule.cursoId)
    )
  }

  function teacherFor(schedule: HorarioCatedratico) {
    return (
      schedule.catedratico ??
      teachers.find((teacher) => teacher.id === schedule.catedraticoId)
    )
  }

  const record = editor === "create" ? null : editor
  const detailCourse = detail ? courseFor(detail) : undefined
  const detailTeacher = detail ? teacherFor(detail) : undefined

  return (
    <>
      <AdminPage
        action={
          <div className="flex flex-wrap gap-2">
            <div className="flex rounded-xl border border-line bg-canvas/50 p-1">
              <button
                className={`rounded-lg px-3 py-2 text-xs font-bold ${
                  view === "week"
                    ? "bg-white text-brand shadow-sm"
                    : "text-muted"
                }`}
                onClick={() => setView("week")}
                type="button"
              >
                Semana
              </button>
              <button
                className={`rounded-lg px-3 py-2 text-xs font-bold ${
                  view === "table"
                    ? "bg-white text-brand shadow-sm"
                    : "text-muted"
                }`}
                onClick={() => setView("table")}
                type="button"
              >
                Tabla
              </button>
            </div>
            {canManage && (
              <button
                className="h-11 rounded-xl bg-brand px-5 text-sm font-bold text-white hover:bg-brand-dark"
                onClick={() => {
                  setError("")
                  setSelectedOfferId("")
                  setEditor("create")
                }}
                type="button"
              >
                + Crear horario
              </button>
            )}
          </div>
        }
        count={
          loading
            ? "Consultando horarios..."
            : `${visibleItems.length} bloques visibles`
        }
        description="Horario semanal autorizado para la cuenta y el período seleccionados."
        title={canManage ? "Horarios docentes" : "Mi horario"}
      >
        <div className="border-b border-line bg-brand-soft/5 px-5 py-3 text-xs leading-5 text-muted sm:px-6">
          El backend admite lunes a sábado. No expone aula ni estado para los
          horarios, por lo que esos datos no se muestran.
        </div>
        <FilterBar
          onSearchChange={setQuery}
          placeholder="Buscar curso, código o catedrático..."
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
          {canManage && (
            <SelectInput
              aria-label="Filtrar por catedrático"
              className="sm:max-w-52"
              onChange={(event) => setTeacherFilter(event.target.value)}
              value={teacherFilter}
            >
              <option value="">Todos los catedráticos</option>
              {teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {fullName(teacher)}
                </option>
              ))}
            </SelectInput>
          )}
          <SelectInput
            aria-label="Filtrar por día"
            className="sm:max-w-40"
            onChange={(event) => setDayFilter(event.target.value)}
            value={dayFilter}
          >
            <option value="">Todos los días</option>
            {DAYS.map((day) => (
              <option key={day} value={day}>
                {DAY_LABELS[day]}
              </option>
            ))}
          </SelectInput>
        </FilterBar>
        {notice && <Notice message={notice} onClose={() => setNotice("")} />}
        {error && !editor && (
          <div className="mx-5 mt-5 sm:mx-6">
            <ErrorState message={error} onRetry={load} />
          </div>
        )}
        {loading ? (
          <LoadingState />
        ) : error && !items.length ? null : !visibleItems.length ? (
          <EmptyState
            description={
              selectedPeriod
                ? `No hay horarios visibles en ${selectedPeriod.nombre}.`
                : "No hay horarios visibles con los filtros actuales."
            }
            title="Sin bloques de horario"
          />
        ) : view === "week" ? (
          <div className="overflow-x-auto p-5 sm:p-6">
            <div className="grid min-w-[66rem] grid-cols-6 gap-3">
              {DAYS.map((day) => {
                const dayItems = visibleItems.filter(
                  (schedule) => schedule.dia === day,
                )
                return (
                  <section
                    className="overflow-hidden rounded-xl border border-line bg-canvas/35"
                    key={day}
                  >
                    <div className="border-b border-line bg-white px-3 py-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-brand">
                        {DAY_LABELS[day]}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {dayItems.length}{" "}
                        {dayItems.length === 1 ? "bloque" : "bloques"}
                      </p>
                    </div>
                    <div className="space-y-2 p-2">
                      {dayItems.length ? (
                        dayItems.map((schedule) => {
                          const course = courseFor(schedule)
                          const teacher = teacherFor(schedule)
                          return (
                            <button
                              className="w-full rounded-lg border border-brand-soft/15 bg-white p-3 text-left shadow-sm transition hover:border-brand-soft/40 hover:shadow"
                              key={schedule.id}
                              onClick={() => openDetail(schedule)}
                              type="button"
                            >
                              <span className="block text-xs font-bold text-brand-soft">
                                {shortTime(schedule.horaInicio)}–{shortTime(schedule.horaFin)}
                              </span>
                              <span className="mt-2 block text-sm font-bold leading-5 text-ink">
                                {course?.nombre ??
                                  `Curso ID ${schedule.cursoId}`}
                              </span>
                              <span className="mt-1 block text-xs leading-5 text-muted">
                                {fullName(teacher)}
                              </span>
                              <span className="mt-2 block font-mono text-[0.65rem] font-bold text-muted">
                                {course?.codigo}
                              </span>
                            </button>
                          )
                        })
                      ) : (
                        <p className="px-2 py-5 text-center text-xs text-muted">
                          Sin clases
                        </p>
                      )}
                    </div>
                  </section>
                )
              })}
            </div>
          </div>
        ) : (
          <DataTable minWidth="min-w-[66rem]">
            <thead>
              <tr className="border-b border-line bg-canvas/45 text-[0.68rem] font-bold uppercase tracking-wider text-muted">
                <th className="px-6 py-3.5">Día y hora</th>
                <th className="px-4 py-3.5">Curso</th>
                <th className="px-4 py-3.5">Catedrático</th>
                <th className="px-4 py-3.5">Período</th>
                <th className="px-6 py-3.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visibleItems.map((schedule) => {
                const course = courseFor(schedule)
                const teacher = teacherFor(schedule)
                return (
                  <tr className="hover:bg-canvas/40" key={schedule.id}>
                    <td className="px-6 py-4">
                      <p className="text-sm font-bold">
                        {DAY_LABELS[schedule.dia]}
                      </p>
                      <p className="mt-1 text-xs text-brand-soft">
                        {shortTime(schedule.horaInicio)}–{shortTime(schedule.horaFin)}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <p className="text-sm font-bold">
                        {course?.nombre ?? `Curso ID ${schedule.cursoId}`}
                      </p>
                      <p className="mt-1 font-mono text-xs text-muted">
                        {course?.codigo}
                      </p>
                    </td>
                    <td className="px-4 py-4 text-sm text-muted">
                      {fullName(teacher)}
                    </td>
                    <td className="px-4 py-4 text-sm text-muted">
                      {schedule.periodo ||
                        periods.find(
                          (period) =>
                            period.id === schedule.periodoAcademicoId,
                        )?.nombre ||
                        "Histórico sin período"}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          className="rounded-lg border border-line px-3 py-2 text-xs font-bold text-muted hover:bg-canvas"
                          onClick={() => openDetail(schedule)}
                          type="button"
                        >
                          Detalle
                        </button>
                        {canManage && (
                          <button
                            className="rounded-lg border border-brand-soft/25 px-3 py-2 text-xs font-bold text-brand-soft hover:bg-brand-soft/5"
                            onClick={() => {
                              setError("")
                              setEditor(schedule)
                            }}
                            type="button"
                          >
                            Editar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </DataTable>
        )}
      </AdminPage>

      <Modal
        description={
          record
            ? "El contrato de edición solo admite día y horas; docente, curso y período permanecen sin cambios."
            : "El backend valida que no existan cruces para el mismo catedrático."
        }
        onClose={() => setEditor(null)}
        open={Boolean(editor)}
        title={record ? "Editar horario" : "Crear horario docente"}
      >
        <form onSubmit={submit}>
          <div className="grid gap-5 px-6 py-6 sm:grid-cols-2">
            {!record && (
              <div className="sm:col-span-2">
                <FormField
                  hint="Selecciona una sección para que los alumnos puedan inscribirse. Sin sección el horario solo habilita las tareas y evaluaciones del docente."
                  label="Sección (opcional para horarios históricos)"
                >
                  <SelectInput
                    name="ofertaCursoId"
                    onChange={(event) => setSelectedOfferId(event.target.value)}
                    value={selectedOfferId}
                  >
                    <option value="">Horario sin sección</option>
                    {offers.filter((offer) => offer.activo).map((offer) => (
                      <option key={offer.id} value={offer.id}>
                        {offer.curso?.codigo} · {offer.codigoSeccion} ·{" "}
                        {offer.periodoAcademico?.nombre}
                      </option>
                    ))}
                  </SelectInput>
                </FormField>
                {catalogErrors.offers ? (
                  <p className="mt-2 text-xs text-red-700">
                    Secciones: {catalogErrors.offers}
                  </p>
                ) : !offers.some((offer) => offer.activo) ? (
                  <p className="mt-2 text-xs text-amber-800">
                    No hay secciones activas
                    {selectedPeriod ? ` en ${selectedPeriod.nombre}` : ""}. Créalas primero en
                    «Oferta de cursos» para habilitar la inscripción de alumnos.
                  </p>
                ) : null}
              </div>
            )}
            {selectedOfferId && !record ? (
              (() => {
                const offer = offers.find((item) => item.id === Number(selectedOfferId))
                if (!offer) return null
                return (
                  <>
                    <input name="catedraticoId" type="hidden" value={offer.catedraticoId} />
                    <input name="cursoId" type="hidden" value={offer.cursoId} />
                    <input name="periodoAcademicoId" type="hidden" value={offer.periodoAcademicoId} />
                    <div className="sm:col-span-2 rounded-xl bg-canvas/55 p-3 text-sm text-muted">
                      {offer.curso?.codigo} · {offer.curso?.nombre} · Sección{" "}
                      {offer.codigoSeccion} ·{" "}
                      {offer.catedratico?.nombre} {offer.catedratico?.apellido} ·{" "}
                      {offer.periodoAcademico?.nombre}
                    </div>
                  </>
                )
              })()
            ) : (
              <>
                <FormField label="Catedrático">
                  <SelectInput
                    defaultValue={record?.catedraticoId}
                    disabled={Boolean(record)}
                    name="catedraticoId"
                    required
                  >
                    <option value="">Selecciona un catedrático</option>
                    {teachers.map((teacher) => (
                      <option key={teacher.id} value={teacher.id}>
                        {fullName(teacher)}
                      </option>
                    ))}
                  </SelectInput>
                  {catalogErrors.teachers ? (
                    <p className="mt-2 text-xs text-red-700">{catalogErrors.teachers}</p>
                  ) : !teachers.length ? (
                    <p className="mt-2 text-xs text-amber-800">No hay catedráticos registrados.</p>
                  ) : null}
                </FormField>
                <FormField label="Curso">
                  <SelectInput
                    defaultValue={record?.cursoId}
                    disabled={Boolean(record)}
                    name="cursoId"
                    required
                  >
                    <option value="">Selecciona un curso</option>
                    {courses
                      .filter((course) => course.activo || course.id === record?.cursoId)
                      .map((course) => (
                        <option key={course.id} value={course.id}>
                          {course.codigo} · {course.nombre}
                        </option>
                      ))}
                  </SelectInput>
                  {catalogErrors.courses && (
                    <p className="mt-2 text-xs text-red-700">{catalogErrors.courses}</p>
                  )}
                </FormField>
                <div className="sm:col-span-2">
                  <FormField label="Período académico">
                    <SelectInput
                      defaultValue={
                        record?.periodoAcademicoId ?? selectedPeriodId ?? ""
                      }
                      disabled={Boolean(record)}
                      name="periodoAcademicoId"
                      required
                    >
                      {record && !record.periodoAcademicoId ? (
                        <option value="">
                          Histórico: {record.periodo || "sin período relacionado"}
                        </option>
                      ) : (
                        <option value="">Selecciona un período</option>
                      )}
                      {periods.map((period) => (
                        <option key={period.id} value={period.id}>
                          {period.nombre} ·{" "}
                          {period.estado === "abierto" ? "abierto" : "cerrado"}
                        </option>
                      ))}
                    </SelectInput>
                  </FormField>
                </div>
              </>
            )}
            <FormField label="Día">
              <SelectInput defaultValue={record?.dia} name="dia" required>
                <option value="">Selecciona un día</option>
                {DAYS.map((day) => (
                  <option key={day} value={day}>
                    {DAY_LABELS[day]}
                  </option>
                ))}
              </SelectInput>
            </FormField>
            <div />
            <FormField label="Hora inicial">
              <TextInput
                defaultValue={
                  record ? shortTime(record.horaInicio) : undefined
                }
                name="horaInicio"
                required
                type="time"
              />
            </FormField>
            <FormField label="Hora final">
              <TextInput
                defaultValue={record ? shortTime(record.horaFin) : undefined}
                name="horaFin"
                required
                type="time"
              />
            </FormField>
          </div>
          <FormActions
            error={error}
            label={record ? "Guardar horario" : "Crear horario"}
            onCancel={() => setEditor(null)}
            saving={saving}
          />
        </form>
      </Modal>

      <Modal
        description="Información del curso y estudiantes visibles según los permisos de la cuenta."
        onClose={() => setDetail(null)}
        open={Boolean(detail)}
        title={detailCourse?.nombre ?? "Detalle del horario"}
      >
        {detail && (
          <div className="space-y-5 px-6 py-6">
            <div className="grid gap-3 rounded-xl bg-canvas/60 p-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">
                  Horario
                </p>
                <p className="mt-1 text-sm font-bold">
                  {DAY_LABELS[detail.dia]} · {shortTime(detail.horaInicio)}–
                  {shortTime(detail.horaFin)}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">
                  Catedrático
                </p>
                <p className="mt-1 text-sm font-bold">
                  {fullName(detailTeacher)}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">
                  Código
                </p>
                <p className="mt-1 font-mono text-sm font-bold text-brand-soft">
                  {detailCourse?.codigo ?? "Sin código visible"}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">
                  Período
                </p>
                <p className="mt-1 text-sm font-bold">
                  {detail.periodo ||
                    periods.find(
                      (period) => period.id === detail.periodoAcademicoId,
                    )?.nombre ||
                    "Histórico sin período"}
                </p>
              </div>
            </div>
            <div>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-bold text-ink">
                  Estudiantes inscritos
                </p>
                {!detailLoading && !detailError && (
                  <span className="rounded-full bg-brand-soft/10 px-2.5 py-1 text-xs font-bold text-brand-soft">
                    {detailAssignments.length}
                  </span>
                )}
              </div>
              {detailLoading ? (
                <div className="rounded-xl border border-line p-4 text-sm text-muted">
                  Consultando estudiantes...
                </div>
              ) : detailError ? (
                <ErrorState
                  message={detailError}
                  onRetry={() => openDetail(detail)}
                />
              ) : detailAssignments.length ? (
                <div className="max-h-64 divide-y divide-line overflow-y-auto rounded-xl border border-line">
                  {detailAssignments.map((assignment) => (
                    <div className="px-4 py-3" key={assignment.id}>
                      <p className="text-sm font-bold">
                        {fullName(assignment.alumno)}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {assignment.alumno?.email ??
                          `Alumno ID ${assignment.alumnoId}`}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-line bg-canvas/40 px-4 py-6 text-center text-sm text-muted">
                  No hay estudiantes visibles para este curso y período.
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
