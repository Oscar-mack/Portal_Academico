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
import { catalogsService, type CursoInput } from "../../services/catalogsService"
import type { Curso, GradoCarrera } from "../../types/api"
import { FormActions, Notice } from "./GradosCarrerasPage"

export default function CursosPage() {
  const [items, setItems] = useState<Curso[]>([])
  const [grades, setGrades] = useState<GradoCarrera[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [gradeFilter, setGradeFilter] = useState("")
  const [editor, setEditor] = useState<Curso | "create" | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const [courses, gradeRows] = await Promise.all([
        catalogsService.listCourses(true),
        catalogsService.listGrades(true),
      ])
      setItems(courses)
      setGrades(gradeRows)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible consultar los cursos.")
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
          item.nombre.toLowerCase().includes(term) ||
          item.codigo.toLowerCase().includes(term) ||
          item.gradoCarrera?.nombre.toLowerCase().includes(term)),
    )
  }, [items, query, gradeFilter])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const item = editor === "create" ? null : editor
    const input: CursoInput = {
      nombre: String(form.get("nombre") ?? "").trim(),
      codigo: String(form.get("codigo") ?? "").trim(),
      creditos: Number(form.get("creditos") || 0),
      gradoCarreraId: Number(form.get("gradoCarreraId")),
      ...(item ? { activo: form.get("activo") === "true" } : {}),
    }
    setSaving(true)
    setError("")
    try {
      if (item) {
        await catalogsService.updateCourse(item.id, input)
        setNotice("El curso se actualizó correctamente.")
      } else {
        await catalogsService.createCourse(input)
        setNotice("El curso se creó correctamente.")
      }
      setEditor(null)
      await load()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible guardar el curso.")
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
            + Crear curso
          </button>
        }
        count={loading ? "Consultando cursos..." : `${items.length} cursos registrados`}
        description="Administra la oferta académica por grado o carrera."
        title="Cursos"
      >
        <FilterBar
          onSearchChange={setQuery}
          placeholder="Buscar por código, nombre o grado..."
          search={query}
        >
          <SelectInput
            aria-label="Filtrar por grado o carrera"
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
        {error && !editor && (
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
                <th className="px-6 py-3.5">Código</th>
                <th className="px-4 py-3.5">Curso</th>
                <th className="px-4 py-3.5">Grado o carrera</th>
                <th className="px-4 py-3.5">Créditos</th>
                <th className="px-4 py-3.5">Estado</th>
                <th className="px-6 py-3.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visibleItems.map((course) => (
                <tr className="hover:bg-canvas/40" key={course.id}>
                  <td className="px-6 py-4 font-mono text-xs font-bold text-brand-soft">
                    {course.codigo}
                  </td>
                  <td className="px-4 py-4 text-sm font-bold">{course.nombre}</td>
                  <td className="px-4 py-4 text-sm text-muted">
                    {course.gradoCarrera?.nombre ??
                      grades.find((grade) => grade.id === course.gradoCarreraId)?.nombre ??
                      `ID ${course.gradoCarreraId}`}
                  </td>
                  <td className="px-4 py-4 text-sm text-muted">{course.creditos}</td>
                  <td className="px-4 py-4">
                    <StatusBadge tone={course.activo ? "success" : "neutral"}>
                      {course.activo ? "Activo" : "Inactivo"}
                    </StatusBadge>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      className="rounded-lg border border-brand-soft/25 px-3 py-2 text-xs font-bold text-brand-soft hover:bg-brand-soft/5"
                      onClick={() => {
                        setError("")
                        setEditor(course)
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
          <EmptyState description="Ajusta la búsqueda o crea el primer curso." title="Sin cursos" />
        )}
      </AdminPage>

      <Modal
        description="El curso debe pertenecer a un grado o carrera existente."
        onClose={() => setEditor(null)}
        open={Boolean(editor)}
        title={item ? "Editar curso" : "Crear curso"}
      >
        <form onSubmit={submit}>
          <div className="grid gap-5 px-6 py-6 sm:grid-cols-2">
            <FormField label="Código">
              <TextInput defaultValue={item?.codigo} name="codigo" required />
            </FormField>
            <FormField label="Créditos">
              <TextInput
                defaultValue={item?.creditos ?? 0}
                min="0"
                name="creditos"
                step="1"
                type="number"
              />
            </FormField>
            <div className="sm:col-span-2">
              <FormField label="Nombre del curso">
                <TextInput defaultValue={item?.nombre} name="nombre" required />
              </FormField>
            </div>
            <div className="sm:col-span-2">
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
            </div>
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
            label={item ? "Guardar cambios" : "Crear curso"}
            onCancel={() => setEditor(null)}
            saving={saving}
          />
        </form>
      </Modal>
    </>
  )
}
