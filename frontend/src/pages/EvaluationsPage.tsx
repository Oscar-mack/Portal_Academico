import { FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import AdminPage from "../components/AdminPage"
import ConfirmDialog from "../components/ConfirmDialog"
import DataTable from "../components/DataTable"
import EmptyState from "../components/EmptyState"
import ErrorState from "../components/ErrorState"
import FilterBar from "../components/FilterBar"
import { FormField, SelectInput, TextInput } from "../components/FormField"
import LoadingState from "../components/LoadingState"
import Modal from "../components/Modal"
import StatusBadge from "../components/StatusBadge"
import { useAcademicPeriod } from "../context/AcademicPeriodContext"
import type { AuthUser } from "../lib/api"
import { academicAssignmentsService } from "../services/academicAssignmentsService"
import { catalogsService } from "../services/catalogsService"
import {
  catedraticosService,
  type Catedratico as TeacherRecord,
} from "../services/catedraticosService"
import { evaluationsService } from "../services/evaluationsService"
import type { Curso, Evaluacion, EvaluacionInput } from "../types/api"
import GradeMatrix from "./GradeMatrix"
import { FormActions, Notice } from "./admin/GradosCarrerasPage"

function fullName(person?: { nombre: string; apellido: string }) {
  return person ? `${person.nombre} ${person.apellido}` : "Sin información"
}

export default function EvaluationsPage({ user }: { user: AuthUser }) {
  const { periods, selectedPeriodId, selectedPeriod } = useAcademicPeriod()
  const [items, setItems] = useState<Evaluacion[]>([])
  const [courses, setCourses] = useState<Curso[]>([])
  const [teachers, setTeachers] = useState<TeacherRecord[]>([])
  const [query, setQuery] = useState("")
  const [courseFilter, setCourseFilter] = useState("")
  const [teacherFilter, setTeacherFilter] = useState("")
  const [editor, setEditor] = useState<Evaluacion | "create" | null>(null)
  const [matrix, setMatrix] = useState<Evaluacion | null>(null)
  const [deactivating, setDeactivating] = useState<Evaluacion | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const periodFilter = selectedPeriodId ?? undefined
      const [evaluationRows, scheduleRows, courseRows] = await Promise.all([
        evaluationsService.list({ periodoAcademicoId: periodFilter }),
        academicAssignmentsService.listSchedules({
          periodoAcademicoId: periodFilter,
        }),
        catalogsService.listCourses(user.rol === "admin"),
      ])
      setItems(evaluationRows)
      setCourses(courseRows)
      if (user.rol === "admin") {
        setTeachers(await catedraticosService.list())
      } else {
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
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible consultar las evaluaciones.",
      )
    } finally {
      setLoading(false)
    }
  }, [selectedPeriodId, user.rol])

  useEffect(() => {
    load()
  }, [load])

  const visibleItems = useMemo(() => {
    const term = query.toLowerCase().trim()
    return items.filter((evaluation) => {
      const course = courses.find((item) => item.id === evaluation.cursoId)
      return (
        (!courseFilter || evaluation.cursoId === Number(courseFilter)) &&
        (!teacherFilter ||
          evaluation.catedraticoId === Number(teacherFilter)) &&
        (!term ||
          evaluation.nombre.toLowerCase().includes(term) ||
          course?.nombre.toLowerCase().includes(term) ||
          course?.codigo.toLowerCase().includes(term))
      )
    })
  }, [items, courses, query, courseFilter, teacherFilter])

  const totals = useMemo(() => {
    const values = new Map<string, number>()
    items
      .filter((evaluation) => evaluation.activo)
      .forEach((evaluation) => {
        const key = `${evaluation.cursoId}:${evaluation.periodoAcademicoId}`
        values.set(key, (values.get(key) ?? 0) + Number(evaluation.puntajeMaximo))
      })
    return values
  }, [items])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const record = editor === "create" ? null : editor
    const maximum = Number(form.get("puntajeMaximo"))
    if (!Number.isFinite(maximum) || maximum <= 0 || maximum > 100) {
      setError("El puntaje máximo debe ser mayor que 0 y no mayor que 100.")
      return
    }
    setSaving(true)
    setError("")
    try {
      if (record) {
        await evaluationsService.update(record.id, {
          nombre: String(form.get("nombre") ?? "").trim(),
          puntajeMaximo: maximum,
        })
        setNotice("La evaluación se actualizó correctamente.")
      } else {
        const input: EvaluacionInput = {
          cursoId: Number(form.get("cursoId")),
          periodoAcademicoId: Number(form.get("periodoAcademicoId")),
          nombre: String(form.get("nombre") ?? "").trim(),
          puntajeMaximo: maximum,
          ...(user.rol === "admin"
            ? { catedraticoId: Number(form.get("catedraticoId")) }
            : {}),
        }
        await evaluationsService.create(input)
        setNotice("La evaluación se creó correctamente.")
      }
      setEditor(null)
      await load()
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible guardar la evaluación.",
      )
    } finally {
      setSaving(false)
    }
  }

  async function deactivate() {
    if (!deactivating) return
    setSaving(true)
    setError("")
    try {
      await evaluationsService.deactivate(deactivating.id)
      setNotice("La evaluación quedó inactiva.")
      setDeactivating(null)
      await load()
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible desactivar la evaluación.",
      )
      setDeactivating(null)
    } finally {
      setSaving(false)
    }
  }

  if (matrix) {
    return (
      <GradeMatrix
        course={courses.find((course) => course.id === matrix.cursoId)}
        evaluation={matrix}
        onBack={() => {
          setMatrix(null)
          load()
        }}
      />
    )
  }

  const record = editor === "create" ? null : editor

  return (
    <>
      <AdminPage
        action={
          <button
            className="h-11 rounded-xl bg-brand px-5 text-sm font-bold text-white hover:bg-brand-dark"
            onClick={() => {
              setError("")
              setEditor("create")
            }}
            type="button"
          >
            + Nueva evaluación
          </button>
        }
        count={
          loading
            ? "Consultando evaluaciones..."
            : `${visibleItems.length} evaluaciones visibles`
        }
        description="Gestiona la estructura de evaluación y registra calificaciones."
        title="Evaluaciones"
      >
        <div className="border-b border-line bg-brand-soft/5 px-5 py-3 text-xs leading-5 text-muted sm:px-6">
          El contrato no incluye descripción ni fecha de evaluación. Los
          puntajes máximos activos de un curso y período no pueden superar 100.
        </div>
        <FilterBar
          onSearchChange={setQuery}
          placeholder="Buscar evaluación, curso o código..."
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
          {user.rol === "admin" && (
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
          <DataTable minWidth="min-w-[68rem]">
            <thead>
              <tr className="border-b border-line bg-canvas/45 text-[0.68rem] font-bold uppercase tracking-wider text-muted">
                <th className="px-6 py-3.5">Evaluación</th>
                <th className="px-4 py-3.5">Curso</th>
                <th className="px-4 py-3.5">Catedrático</th>
                <th className="px-4 py-3.5">Período</th>
                <th className="px-4 py-3.5">Puntaje</th>
                <th className="px-4 py-3.5">Estado</th>
                <th className="px-6 py-3.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visibleItems.map((evaluation) => {
                const course = courses.find(
                  (item) => item.id === evaluation.cursoId,
                )
                const teacher = teachers.find(
                  (item) => item.id === evaluation.catedraticoId,
                )
                const total =
                  totals.get(
                    `${evaluation.cursoId}:${evaluation.periodoAcademicoId}`,
                  ) ?? 0
                return (
                  <tr className="hover:bg-canvas/40" key={evaluation.id}>
                    <td className="px-6 py-4">
                      <p className="text-sm font-bold">{evaluation.nombre}</p>
                      <p className="mt-1 text-xs text-muted">
                        ID {evaluation.id}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <p className="text-sm font-bold">
                        {course?.nombre ?? `Curso ID ${evaluation.cursoId}`}
                      </p>
                      <p className="mt-1 font-mono text-xs text-brand-soft">
                        {course?.codigo}
                      </p>
                    </td>
                    <td className="px-4 py-4 text-sm text-muted">
                      {fullName(teacher)}
                    </td>
                    <td className="px-4 py-4 text-sm text-muted">
                      {periods.find(
                        (period) =>
                          period.id === evaluation.periodoAcademicoId,
                      )?.nombre ?? `ID ${evaluation.periodoAcademicoId}`}
                    </td>
                    <td className="px-4 py-4">
                      <p className="text-sm font-bold">
                        {Number(evaluation.puntajeMaximo)}
                      </p>
                      <p
                        className={`mt-1 text-xs font-semibold ${
                          total === 100 ? "text-emerald-700" : "text-amber-700"
                        }`}
                      >
                        Total activo: {total}/100
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge
                        tone={evaluation.activo ? "success" : "neutral"}
                      >
                        {evaluation.activo ? "Activa" : "Inactiva"}
                      </StatusBadge>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-2">
                        {evaluation.activo && (
                          <button
                            className="rounded-lg bg-brand px-3 py-2 text-xs font-bold text-white"
                            onClick={() => setMatrix(evaluation)}
                            type="button"
                          >
                            Calificaciones
                          </button>
                        )}
                        <button
                          className="rounded-lg border border-brand-soft/25 px-3 py-2 text-xs font-bold text-brand-soft hover:bg-brand-soft/5"
                          onClick={() => {
                            setError("")
                            setEditor(evaluation)
                          }}
                          type="button"
                        >
                          Editar
                        </button>
                        {evaluation.activo && (
                          <button
                            className="rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50"
                            onClick={() => setDeactivating(evaluation)}
                            type="button"
                          >
                            Desactivar
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
                ? `No hay evaluaciones visibles en ${selectedPeriod.nombre}.`
                : "No hay evaluaciones visibles con los filtros actuales."
            }
            title="Sin evaluaciones"
          />
        )}
      </AdminPage>

      <Modal
        description={
          record
            ? "Curso, catedrático y período no pueden cambiarse mediante el contrato de edición."
            : "El catedrático debe tener un horario del curso en el período seleccionado."
        }
        onClose={() => setEditor(null)}
        open={Boolean(editor)}
        title={record ? "Editar evaluación" : "Crear evaluación"}
      >
        <form onSubmit={submit}>
          <div className="grid gap-5 px-6 py-6 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FormField label="Nombre de la evaluación">
                <TextInput
                  defaultValue={record?.nombre}
                  maxLength={120}
                  name="nombre"
                  required
                />
              </FormField>
            </div>
            <FormField label="Puntaje máximo">
              <TextInput
                defaultValue={record ? Number(record.puntajeMaximo) : ""}
                max="100"
                min="0.01"
                name="puntajeMaximo"
                required
                step="0.01"
                type="number"
              />
            </FormField>
            {!record && user.rol === "admin" && (
              <FormField label="Catedrático">
                <SelectInput name="catedraticoId" required>
                  <option value="">Selecciona un catedrático</option>
                  {teachers.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>
                      {fullName(teacher)}
                    </option>
                  ))}
                </SelectInput>
              </FormField>
            )}
            {!record && (
              <>
                <FormField label="Curso">
                  <SelectInput name="cursoId" required>
                    <option value="">Selecciona un curso</option>
                    {courses
                      .filter((course) => course.activo)
                      .map((course) => (
                        <option key={course.id} value={course.id}>
                          {course.codigo} · {course.nombre}
                        </option>
                      ))}
                  </SelectInput>
                </FormField>
                <FormField label="Período académico">
                  <SelectInput
                    defaultValue={selectedPeriodId ?? ""}
                    name="periodoAcademicoId"
                    required
                  >
                    <option value="">Selecciona un período</option>
                    {periods.map((period) => (
                      <option key={period.id} value={period.id}>
                        {period.nombre} · {period.estado}
                      </option>
                    ))}
                  </SelectInput>
                </FormField>
              </>
            )}
          </div>
          <FormActions
            error={error}
            label={record ? "Guardar cambios" : "Crear evaluación"}
            onCancel={() => setEditor(null)}
            saving={saving}
          />
        </form>
      </Modal>

      <ConfirmDialog
        confirmLabel="Desactivar evaluación"
        confirming={saving}
        confirmingLabel="Desactivando..."
        message="La evaluación quedará inactiva. El backend rechazará la operación si ya contiene calificaciones."
        onCancel={() => setDeactivating(null)}
        onConfirm={deactivate}
        open={Boolean(deactivating)}
        title="¿Desactivar evaluación?"
      />
    </>
  )
}
