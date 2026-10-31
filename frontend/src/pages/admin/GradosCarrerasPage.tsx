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
import {
  catalogsService,
  type GradoCarreraInput,
} from "../../services/catalogsService"
import type { GradoCarrera } from "../../types/api"

export default function GradosCarrerasPage() {
  const [items, setItems] = useState<GradoCarrera[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [editor, setEditor] = useState<GradoCarrera | "create" | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      setItems(await catalogsService.listGrades(true))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible consultar los registros.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const visibleItems = useMemo(() => {
    const term = query.toLowerCase().trim()
    return items.filter((item) =>
      [item.nombre, item.nivel, item.descripcion]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(term)),
    )
  }, [items, query])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const item = editor === "create" ? null : editor
    const input: GradoCarreraInput = {
      nombre: String(form.get("nombre") ?? "").trim(),
      nivel: String(form.get("nivel") ?? "").trim() || undefined,
      descripcion: String(form.get("descripcion") ?? "").trim() || undefined,
      ...(item ? { activo: form.get("activo") === "true" } : {}),
    }
    setSaving(true)
    setError("")
    try {
      if (item) {
        await catalogsService.updateGrade(item.id, input)
        setNotice("El grado o carrera se actualizó correctamente.")
      } else {
        await catalogsService.createGrade(input)
        setNotice("El grado o carrera se creó correctamente.")
      }
      setEditor(null)
      await load()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible guardar el registro.")
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
            + Nuevo grado o carrera
          </button>
        }
        count={loading ? "Consultando registros..." : `${items.length} registros`}
        description="Administra los niveles académicos de la institución."
        title="Grados y carreras"
      >
        <FilterBar
          onSearchChange={setQuery}
          placeholder="Buscar por nombre, nivel o descripción..."
          search={query}
        />
        {notice && <Notice message={notice} onClose={() => setNotice("")} />}
        {error && !editor && (
          <div className="mx-5 mt-5 sm:mx-6">
            <ErrorState message={error} onRetry={load} />
          </div>
        )}
        {loading ? (
          <LoadingState />
        ) : visibleItems.length ? (
          <DataTable minWidth="min-w-[46rem]">
            <thead>
              <tr className="border-b border-line bg-canvas/45 text-[0.68rem] font-bold uppercase tracking-wider text-muted">
                <th className="px-6 py-3.5">Nombre</th>
                <th className="px-4 py-3.5">Nivel</th>
                <th className="px-4 py-3.5">Descripción</th>
                <th className="px-4 py-3.5">Estado</th>
                <th className="px-6 py-3.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visibleItems.map((record) => (
                <tr className="hover:bg-canvas/40" key={record.id}>
                  <td className="px-6 py-4 text-sm font-bold">{record.nombre}</td>
                  <td className="px-4 py-4 text-sm text-muted">{record.nivel || "Sin nivel"}</td>
                  <td className="max-w-sm px-4 py-4 text-sm text-muted">
                    {record.descripcion || "Sin descripción"}
                  </td>
                  <td className="px-4 py-4">
                    <StatusBadge tone={record.activo ? "success" : "neutral"}>
                      {record.activo ? "Activo" : "Inactivo"}
                    </StatusBadge>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      className="rounded-lg border border-brand-soft/25 px-3 py-2 text-xs font-bold text-brand-soft hover:bg-brand-soft/5"
                      onClick={() => {
                        setError("")
                        setEditor(record)
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
          <EmptyState
            description="No hay grados o carreras que coincidan con la búsqueda."
            title="Sin resultados"
          />
        )}
      </AdminPage>

      <Modal
        description="Utiliza únicamente la información académica definida por la institución."
        onClose={() => setEditor(null)}
        open={Boolean(editor)}
        title={item ? "Editar grado o carrera" : "Crear grado o carrera"}
      >
        <form onSubmit={submit}>
          <div className="space-y-5 px-6 py-6">
            <FormField label="Nombre">
              <TextInput defaultValue={item?.nombre} name="nombre" required />
            </FormField>
            <FormField label="Nivel">
              <TextInput defaultValue={item?.nivel} name="nivel" placeholder="Ej. Universitario" />
            </FormField>
            <FormField label="Descripción">
              <TextInput defaultValue={item?.descripcion} name="descripcion" />
            </FormField>
            {item && (
              <FormField label="Estado">
                <SelectInput defaultValue={String(item.activo)} name="activo">
                  <option value="true">Activo</option>
                  <option value="false">Inactivo</option>
                </SelectInput>
              </FormField>
            )}
          </div>
          <FormActions
            error={error}
            label={item ? "Guardar cambios" : "Crear registro"}
            onCancel={() => setEditor(null)}
            saving={saving}
          />
        </form>
      </Modal>
    </>
  )
}

export function Notice({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="mx-5 mt-5 flex justify-between gap-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 sm:mx-6">
      <span>{message}</span>
      <button onClick={onClose} type="button">
        ×
      </button>
    </div>
  )
}

export function FormActions({
  error,
  label,
  saving,
  onCancel,
}: {
  error: string
  label: string
  saving: boolean
  onCancel: () => void
}) {
  return (
    <>
      {error && (
        <div className="mx-6 mb-5">
          <ErrorState message={error} />
        </div>
      )}
      <div className="flex justify-end gap-3 border-t border-line bg-canvas/45 px-6 py-4">
        <button
          className="rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-bold text-muted"
          disabled={saving}
          onClick={onCancel}
          type="button"
        >
          Cancelar
        </button>
        <button
          className="rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60"
          disabled={saving}
          type="submit"
        >
          {saving ? "Guardando..." : label}
        </button>
      </div>
    </>
  )
}
