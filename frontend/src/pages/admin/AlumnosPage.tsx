import { FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import AdminPage from "../../components/AdminPage"
import DataTable from "../../components/DataTable"
import EmptyState from "../../components/EmptyState"
import ErrorState from "../../components/ErrorState"
import FilterBar from "../../components/FilterBar"
import { FormField, SelectInput, TextInput } from "../../components/FormField"
import LoadingState from "../../components/LoadingState"
import Modal from "../../components/Modal"
import StatusBadge from "../../components/StatusBadge"
import { catalogsService, type AlumnoInput } from "../../services/catalogsService"
import type { Alumno, GradoCarrera } from "../../types/api"
import { FormActions, Notice } from "./GradosCarrerasPage"

type Editor = Alumno | "create" | null

export default function AlumnosPage() {
  const [items, setItems] = useState<Alumno[]>([])
  const [grades, setGrades] = useState<GradoCarrera[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [gradeFilter, setGradeFilter] = useState("")
  const [editor, setEditor] = useState<Editor>(null)
  const [detail, setDetail] = useState<Alumno | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const [students, gradeRows] = await Promise.all([
        catalogsService.listStudents({ incluirInactivos: true }),
        catalogsService.listGrades(true),
      ])
      setItems(students)
      setGrades(gradeRows)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible consultar los alumnos.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const visibleItems = useMemo(() => {
    const term = query.toLowerCase().trim()
    return items.filter(
      (item) =>
        (!gradeFilter || item.gradoCarreraId === Number(gradeFilter)) &&
        (!term ||
          `${item.nombre} ${item.apellido}`.toLowerCase().includes(term) ||
          item.email.toLowerCase().includes(term) ||
          String(item.id).includes(term)),
    )
  }, [items, query, gradeFilter])

  async function openDetail(student: Alumno) {
    setDetailLoading(true)
    setError("")
    try {
      setDetail(await catalogsService.getStudent(student.id))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible consultar el perfil.")
    } finally {
      setDetailLoading(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const item = editor === "create" ? null : editor
    const input: AlumnoInput = {
      nombre: String(form.get("nombre") ?? "").trim(),
      apellido: String(form.get("apellido") ?? "").trim(),
      email: String(form.get("email") ?? "").trim(),
      telefono: String(form.get("telefono") ?? "").trim() || undefined,
      gradoCarreraId: Number(form.get("gradoCarreraId")),
      ...(item ? { activo: form.get("activo") === "true" } : {}),
    }
    setSaving(true)
    setError("")
    try {
      if (item) {
        await catalogsService.updateStudent(item.id, input)
        setNotice("La información del alumno se actualizó correctamente.")
      } else {
        await catalogsService.createStudent(input)
        setNotice("El alumno se registró correctamente.")
      }
      setEditor(null)
      await load()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible guardar el alumno.")
    } finally {
      setSaving(false)
    }
  }

  const item = editor === "create" ? null : editor

  return (
    <>
      <AdminPage
        action={
          <button
            className="h-11 rounded-xl bg-brand px-5 text-sm font-bold text-white hover:bg-brand-dark"
            onClick={() => setEditor("create")}
            type="button"
          >
            + Registrar alumno
          </button>
        }
        count={loading ? "Consultando alumnos..." : `${items.length} alumnos registrados`}
        description="Consulta y administra la información académica de los estudiantes."
        title="Alumnos"
      >
        <FilterBar
          onSearchChange={setQuery}
          placeholder="Buscar por ID, nombre o correo..."
          search={query}
        >
          <SelectInput
            aria-label="Filtrar alumnos por grado"
            className="sm:max-w-64"
            onChange={(event) => setGradeFilter(event.target.value)}
            value={gradeFilter}
          >
            <option value="">Todos los grados y carreras</option>
            {grades.map((grade) => (
              <option key={grade.id} value={grade.id}>
                {grade.nombre}
              </option>
            ))}
          </SelectInput>
        </FilterBar>
        {notice && <Notice message={notice} onClose={() => setNotice("")} />}
        {error && !editor && !detail && (
          <div className="mx-5 mt-5 sm:mx-6">
            <ErrorState message={error} onRetry={load} />
          </div>
        )}
        {loading ? (
          <LoadingState />
        ) : visibleItems.length ? (
          <DataTable>
            <thead>
              <tr className="border-b border-line bg-canvas/45 text-[0.68rem] font-bold uppercase tracking-wider text-muted">
                <th className="px-6 py-3.5">Alumno</th>
                <th className="px-4 py-3.5">Correo</th>
                <th className="px-4 py-3.5">Grado o carrera</th>
                <th className="px-4 py-3.5">Estado</th>
                <th className="px-6 py-3.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visibleItems.map((student) => (
                <tr className="hover:bg-canvas/40" key={student.id}>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="grid size-10 place-items-center rounded-full bg-brand-soft/10 text-xs font-bold text-brand-soft">
                        {student.nombre[0]}
                        {student.apellido[0]}
                      </div>
                      <div>
                        <p className="text-sm font-bold">
                          {student.nombre} {student.apellido}
                        </p>
                        <p className="mt-0.5 text-xs text-muted">ID {student.id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-sm text-muted">{student.email}</td>
                  <td className="px-4 py-4 text-sm text-muted">
                    {student.gradoCarrera?.nombre ??
                      grades.find((grade) => grade.id === student.gradoCarreraId)?.nombre}
                  </td>
                  <td className="px-4 py-4">
                    <StatusBadge tone={student.activo ? "success" : "neutral"}>
                      {student.activo ? "Activo" : "Inactivo"}
                    </StatusBadge>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex justify-end gap-2">
                      <button
                        className="rounded-lg border border-line px-3 py-2 text-xs font-bold text-muted hover:bg-canvas"
                        onClick={() => openDetail(student)}
                        type="button"
                      >
                        Perfil
                      </button>
                      <button
                        className="rounded-lg border border-brand-soft/25 px-3 py-2 text-xs font-bold text-brand-soft hover:bg-brand-soft/5"
                        onClick={() => {
                          setError("")
                          setEditor(student)
                        }}
                        type="button"
                      >
                        Editar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : (
          <EmptyState description="Ajusta los filtros o registra un nuevo alumno." title="Sin alumnos" />
        )}
      </AdminPage>

      <Modal
        description="El alumno debe estar relacionado con un grado o carrera existente."
        onClose={() => setEditor(null)}
        open={Boolean(editor)}
        title={item ? "Editar alumno" : "Registrar alumno"}
      >
        <form onSubmit={submit}>
          <div className="grid gap-5 px-6 py-6 sm:grid-cols-2">
            <FormField label="Nombre">
              <TextInput defaultValue={item?.nombre} name="nombre" required />
            </FormField>
            <FormField label="Apellido">
              <TextInput defaultValue={item?.apellido} name="apellido" required />
            </FormField>
            <div className="sm:col-span-2">
              <FormField label="Correo electrónico">
                <TextInput defaultValue={item?.email} name="email" required type="email" />
              </FormField>
            </div>
            <FormField label="Teléfono">
              <TextInput defaultValue={item?.telefono} name="telefono" />
            </FormField>
            <FormField label="Grado o carrera">
              <SelectInput defaultValue={item?.gradoCarreraId} name="gradoCarreraId" required>
                <option value="">Selecciona un registro</option>
                {grades.filter((grade) => grade.activo || grade.id === item?.gradoCarreraId).map((grade) => (
                  <option key={grade.id} value={grade.id}>
                    {grade.nombre}
                  </option>
                ))}
              </SelectInput>
            </FormField>
            {item && (
              <div className="sm:col-span-2">
                <FormField label="Estado">
                  <SelectInput defaultValue={String(item.activo)} name="activo">
                    <option value="true">Activo</option>
                    <option value="false">Inactivo</option>
                  </SelectInput>
                </FormField>
              </div>
            )}
          </div>
          <FormActions
            error={error}
            label={item ? "Guardar cambios" : "Registrar alumno"}
            onCancel={() => setEditor(null)}
            saving={saving}
          />
        </form>
      </Modal>

      <Modal
        description="Información disponible para el perfil académico."
        onClose={() => setDetail(null)}
        open={Boolean(detail) || detailLoading}
        title="Perfil del alumno"
      >
        {detailLoading ? (
          <LoadingState rows={3} />
        ) : detail ? (
          <div className="space-y-6 px-6 py-6">
            <div className="flex items-center gap-4">
              <div className="grid size-14 place-items-center rounded-full bg-brand text-sm font-bold text-white">
                {detail.nombre[0]}
                {detail.apellido[0]}
              </div>
              <div>
                <p className="text-lg font-bold">
                  {detail.nombre} {detail.apellido}
                </p>
                <p className="mt-1 text-sm text-muted">{detail.email}</p>
              </div>
            </div>
            <dl className="grid gap-4 rounded-xl bg-canvas/60 p-5 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-bold uppercase text-muted">Grado o carrera</dt>
                <dd className="mt-1 text-sm">{detail.gradoCarrera?.nombre || "No disponible"}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase text-muted">Teléfono</dt>
                <dd className="mt-1 text-sm">{detail.telefono || "No registrado"}</dd>
              </div>
            </dl>
            <div>
              <p className="text-sm font-bold">Cursos asociados</p>
              {detail.cursos?.length ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {detail.cursos.map((course) => (
                    <div className="rounded-xl border border-line p-3" key={course.id}>
                      <p className="text-sm font-bold">{course.nombre}</p>
                      <p className="mt-1 text-xs text-muted">{course.codigo}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted">No hay cursos asociados disponibles.</p>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  )
}
