import { FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import AdminPage from "../components/AdminPage"
import DataTable from "../components/DataTable"
import EmptyState from "../components/EmptyState"
import ErrorState from "../components/ErrorState"
import FilterBar from "../components/FilterBar"
import { FormField, SelectInput } from "../components/FormField"
import LoadingState from "../components/LoadingState"
import Modal from "../components/Modal"
import { useAcademicPeriod } from "../context/AcademicPeriodContext"
import type { AuthUser } from "../lib/api"
import {
  academicAssignmentsService,
  type AssignmentInput,
} from "../services/academicAssignmentsService"
import { catalogsService } from "../services/catalogsService"
import { catedraticosService } from "../services/catedraticosService"
import type {
  Alumno,
  AsignacionCurso,
  Curso,
  HorarioCatedratico,
} from "../types/api"
import { FormActions, Notice } from "./admin/GradosCarrerasPage"

function fullName(person?: { nombre: string; apellido: string }) {
  return person ? `${person.nombre} ${person.apellido}` : "Sin información"
}

export default function AcademicAssignmentsPage({ user }: { user: AuthUser }) {
  const { periods, selectedPeriodId, selectedPeriod } = useAcademicPeriod()
  const canManage = user.rol === "admin"
  const [items, setItems] = useState<AsignacionCurso[]>([])
  const [courses, setCourses] = useState<Curso[]>([])
  const [students, setStudents] = useState<Alumno[]>([])
  const [schedules, setSchedules] = useState<HorarioCatedratico[]>([])
  const [teachers, setTeachers] = useState<
    Array<{ id: number; nombre: string; apellido: string }>
  >([])
  const [query, setQuery] = useState("")
  const [courseFilter, setCourseFilter] = useState("")
  const [teacherFilter, setTeacherFilter] = useState("")
  const [editor, setEditor] = useState<AsignacionCurso | "create" | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const periodFilter = selectedPeriodId ?? undefined
      const requests: [
        Promise<AsignacionCurso[]>,
        Promise<Curso[]>,
        Promise<Alumno[]>,
        Promise<HorarioCatedratico[]>,
      ] = [
        academicAssignmentsService.listAssignments({
          periodoAcademicoId: periodFilter,
        }),
        catalogsService.listCourses(canManage),
        catalogsService.listStudents({ incluirInactivos: canManage }),
        academicAssignmentsService.listSchedules({
          periodoAcademicoId: periodFilter,
        }),
      ]
      const [assignments, courseRows, studentRows, scheduleRows] =
        await Promise.all(requests)
      setItems(assignments)
      setCourses(courseRows)
      setStudents(studentRows)
      setSchedules(scheduleRows)
      if (canManage) {
        const teacherRows = await catedraticosService.list()
        setTeachers(teacherRows)
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible consultar las asignaciones.",
      )
    } finally {
      setLoading(false)
    }
  }, [canManage, selectedPeriodId])

  useEffect(() => {
    load()
  }, [load])

  const teacherNamesByCourse = useMemo(() => {
    const result = new Map<number, Set<string>>()
    schedules.forEach((schedule) => {
      const name = schedule.catedratico
        ? fullName(schedule.catedratico)
        : teachers.find((teacher) => teacher.id === schedule.catedraticoId)
          ? fullName(teachers.find((teacher) => teacher.id === schedule.catedraticoId))
          : `Docente ID ${schedule.catedraticoId}`
      const names = result.get(schedule.cursoId) ?? new Set<string>()
      names.add(name)
      result.set(schedule.cursoId, names)
    })
    return result
  }, [schedules, teachers])

  const teacherCourseIds = useMemo(
    () =>
      new Set(
        schedules
          .filter(
            (schedule) =>
              !teacherFilter || schedule.catedraticoId === Number(teacherFilter),
          )
          .map((schedule) => schedule.cursoId),
      ),
    [schedules, teacherFilter],
  )

  const visibleItems = useMemo(() => {
    const term = query.toLowerCase().trim()
    return items.filter((item) => {
      const course =
        item.curso ?? courses.find((candidate) => candidate.id === item.cursoId)
      const student =
        item.alumno ?? students.find((candidate) => candidate.id === item.alumnoId)
      return (
        (!courseFilter || item.cursoId === Number(courseFilter)) &&
        (!teacherFilter || teacherCourseIds.has(item.cursoId)) &&
        (!term ||
          fullName(student).toLowerCase().includes(term) ||
          course?.nombre.toLowerCase().includes(term) ||
          course?.codigo.toLowerCase().includes(term) ||
          course?.gradoCarrera?.nombre.toLowerCase().includes(term))
      )
    })
  }, [
    items,
    query,
    courseFilter,
    teacherFilter,
    teacherCourseIds,
    courses,
    students,
  ])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const record = editor === "create" ? null : editor
    const periodValue = String(form.get("periodoAcademicoId") ?? "")
    const input: AssignmentInput = {
      alumnoId: Number(form.get("alumnoId")),
      cursoId: Number(form.get("cursoId")),
      ...(periodValue === "legacy" && record
        ? { periodo: record.periodo }
        : { periodoAcademicoId: Number(periodValue) }),
    }
    const student = students.find((item) => item.id === input.alumnoId)
    const course = courses.find((item) => item.id === input.cursoId)
    if (
      student &&
      course &&
      student.gradoCarreraId !== course.gradoCarreraId
    ) {
      setError(
        "El curso no pertenece al grado o carrera del alumno seleccionado.",
      )
      return
    }

    setSaving(true)
    setError("")
    try {
      if (record) {
        await academicAssignmentsService.updateAssignment(record.id, input)
        setNotice("La asignación se actualizó correctamente.")
      } else {
        await academicAssignmentsService.createAssignment(input)
        setNotice("El alumno fue asignado al curso correctamente.")
      }
      setEditor(null)
      await load()
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible guardar la asignación.",
      )
    } finally {
      setSaving(false)
    }
  }

  const record = editor === "create" ? null : editor
  const defaultPeriod = record?.periodoAcademicoId ?? selectedPeriodId ?? ""
  const title =
    user.rol === "admin"
      ? "Asignaciones de cursos"
      : user.rol === "catedratico"
        ? "Mis alumnos"
        : "Mis cursos"

  return (
    <>
      <AdminPage
        action={
          canManage ? (
            <button
              className="h-11 rounded-xl bg-brand px-5 text-sm font-bold text-white hover:bg-brand-dark"
              onClick={() => {
                setError("")
                setEditor("create")
              }}
              type="button"
            >
              + Asignar alumno
            </button>
          ) : undefined
        }
        count={
          loading
            ? "Consultando asignaciones..."
            : `${visibleItems.length} asignaciones visibles`
        }
        description="Consulta las relaciones autorizadas entre alumnos, cursos y períodos."
        title={title}
      >
        {canManage && (
          <div className="border-b border-line bg-brand-soft/5 px-5 py-3 text-xs leading-5 text-muted sm:px-6">
            El catedrático se vincula al curso mediante un horario docente. La
            API no define estado para una asignación de alumno.
          </div>
        )}
        <FilterBar
          onSearchChange={setQuery}
          placeholder="Buscar alumno, curso, código o grado..."
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
          {canManage && (
            <SelectInput
              aria-label="Filtrar por catedrático"
              className="sm:max-w-56"
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
        </FilterBar>
        {notice && <Notice message={notice} onClose={() => setNotice("")} />}
        {error && !editor && (
          <div className="mx-5 mt-5 sm:mx-6">
            <ErrorState message={error} onRetry={load} />
          </div>
        )}
        {loading ? (
          <LoadingState />
        ) : visibleItems.length ? (
          <DataTable minWidth="min-w-[64rem]">
            <thead>
              <tr className="border-b border-line bg-canvas/45 text-[0.68rem] font-bold uppercase tracking-wider text-muted">
                <th className="px-6 py-3.5">Alumno</th>
                <th className="px-4 py-3.5">Curso</th>
                <th className="px-4 py-3.5">Grado o carrera</th>
                <th className="px-4 py-3.5">Catedrático por horario</th>
                <th className="px-4 py-3.5">Período</th>
                {canManage && (
                  <th className="px-6 py-3.5 text-right">Acciones</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visibleItems.map((assignment) => {
                const course =
                  assignment.curso ??
                  courses.find((item) => item.id === assignment.cursoId)
                const student =
                  assignment.alumno ??
                  students.find((item) => item.id === assignment.alumnoId)
                const teacherNames = [
                  ...(teacherNamesByCourse.get(assignment.cursoId) ?? []),
                ]
                return (
                  <tr className="hover:bg-canvas/40" key={assignment.id}>
                    <td className="px-6 py-4">
                      <p className="text-sm font-bold">{fullName(student)}</p>
                      <p className="mt-1 text-xs text-muted">
                        {student?.email ?? `Alumno ID ${assignment.alumnoId}`}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <p className="text-sm font-bold">
                        {course?.nombre ?? `Curso ID ${assignment.cursoId}`}
                      </p>
                      <p className="mt-1 font-mono text-xs text-brand-soft">
                        {course?.codigo}
                      </p>
                    </td>
                    <td className="px-4 py-4 text-sm text-muted">
                      {course?.gradoCarrera?.nombre ??
                        student?.gradoCarrera?.nombre ??
                        "Sin detalle"}
                    </td>
                    <td className="px-4 py-4 text-sm text-muted">
                      {teacherNames.length
                        ? teacherNames.join(", ")
                        : "Sin horario docente"}
                    </td>
                    <td className="px-4 py-4 text-sm text-muted">
                      {assignment.periodo ||
                        periods.find(
                          (period) =>
                            period.id === assignment.periodoAcademicoId,
                        )?.nombre ||
                        "Histórico sin período"}
                    </td>
                    {canManage && (
                      <td className="px-6 py-4 text-right">
                        <button
                          className="rounded-lg border border-brand-soft/25 px-3 py-2 text-xs font-bold text-brand-soft hover:bg-brand-soft/5"
                          onClick={() => {
                            setError("")
                            setEditor(assignment)
                          }}
                          type="button"
                        >
                          Editar
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </DataTable>
        ) : (
          <EmptyState
            description={
              selectedPeriod
                ? `No hay asignaciones visibles en ${selectedPeriod.nombre}.`
                : "No hay asignaciones visibles con los filtros actuales."
            }
            title="Sin asignaciones"
          />
        )}
      </AdminPage>

      <Modal
        description="La API valida duplicados y exige que alumno y curso pertenezcan al mismo grado o carrera."
        onClose={() => setEditor(null)}
        open={Boolean(editor)}
        title={record ? "Editar asignación" : "Asignar alumno a curso"}
      >
        <form onSubmit={submit}>
          <div className="space-y-5 px-6 py-6">
            <FormField label="Alumno">
              <SelectInput
                defaultValue={record?.alumnoId}
                name="alumnoId"
                required
              >
                <option value="">Selecciona un alumno</option>
                {students
                  .filter((student) => student.activo || student.id === record?.alumnoId)
                  .map((student) => (
                    <option key={student.id} value={student.id}>
                      {fullName(student)} ·{" "}
                      {student.gradoCarrera?.nombre ?? "Sin grado"}
                    </option>
                  ))}
              </SelectInput>
            </FormField>
            <FormField label="Curso">
              <SelectInput
                defaultValue={record?.cursoId}
                name="cursoId"
                required
              >
                <option value="">Selecciona un curso</option>
                {courses
                  .filter((course) => course.activo || course.id === record?.cursoId)
                  .map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.codigo} · {course.nombre} ·{" "}
                      {course.gradoCarrera?.nombre ?? "Sin grado"}
                    </option>
                  ))}
              </SelectInput>
            </FormField>
            <FormField
              hint="Los registros históricos sin relación formal conservan su valor original."
              label="Período académico"
            >
              <SelectInput
                defaultValue={
                  record && !record.periodoAcademicoId
                    ? "legacy"
                    : String(defaultPeriod)
                }
                name="periodoAcademicoId"
                required
              >
                <option value="">Selecciona un período</option>
                {record && !record.periodoAcademicoId && (
                  <option value="legacy">
                    Histórico: {record.periodo || "sin período relacionado"}
                  </option>
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
          <FormActions
            error={error}
            label={record ? "Guardar cambios" : "Crear asignación"}
            onCancel={() => setEditor(null)}
            saving={saving}
          />
        </form>
      </Modal>
    </>
  )
}
