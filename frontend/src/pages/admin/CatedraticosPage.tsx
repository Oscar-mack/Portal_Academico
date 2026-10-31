import { FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import ConfirmDialog from "../../components/ConfirmDialog"
import Modal from "../../components/Modal"
import StatusBadge from "../../components/StatusBadge"
import { ApiError } from "../../lib/api"
import {
  Catedratico,
  CatedraticoInput,
  catedraticosService,
} from "../../services/catedraticosService"

type ModalMode = "create" | "edit" | "view" | null

function fullName(item: Catedratico) {
  return `${item.nombre} ${item.apellido}`.trim()
}

function initials(item: Catedratico) {
  return `${item.nombre[0] ?? ""}${item.apellido[0] ?? ""}`.toUpperCase()
}

function Field({
  label,
  name,
  type = "text",
  defaultValue,
  required,
  placeholder,
}: {
  label: string
  name: string
  type?: string
  defaultValue?: string
  required?: boolean
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-ink">{label}</span>
      <input
        className="h-11 w-full rounded-xl border border-line bg-white px-3.5 text-sm text-ink outline-none transition placeholder:text-muted/55 focus:border-brand-soft focus:ring-4 focus:ring-brand-soft/10"
        defaultValue={defaultValue}
        name={name}
        placeholder={placeholder}
        required={required}
        type={type}
      />
    </label>
  )
}

export default function CatedraticosPage() {
  const [items, setItems] = useState<Catedratico[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [query, setQuery] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [selected, setSelected] = useState<Catedratico | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Catedratico | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      setItems(await catedraticosService.list())
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible consultar los catedráticos.",
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const filteredItems = useMemo(() => {
    const term = query.toLowerCase().trim()
    if (!term) return items

    return items.filter((item) =>
      [fullName(item), item.email, item.telefono, item.especialidad]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(term)),
    )
  }, [items, query])

  function openCreate() {
    setSelected(null)
    setError("")
    setModalMode("create")
  }

  async function openDetails(item: Catedratico, mode: "view" | "edit") {
    setError("")
    try {
      const detail = await catedraticosService.get(item.id)
      setSelected(detail)
      setModalMode(mode)
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "No fue posible consultar el registro.",
      )
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const payload: CatedraticoInput = {
      nombre: String(form.get("nombre") ?? "").trim(),
      apellido: String(form.get("apellido") ?? "").trim(),
      email: String(form.get("email") ?? "").trim(),
      telefono: String(form.get("telefono") ?? "").trim() || undefined,
      especialidad: String(form.get("especialidad") ?? "").trim() || undefined,
    }
    setSaving(true)
    setError("")

    try {
      if (modalMode === "edit" && selected) {
        await catedraticosService.update(selected.id, payload)
        setNotice("Los datos del catedrático se actualizaron correctamente.")
      } else {
        await catedraticosService.create(payload)
        setNotice("El catedrático se registró correctamente.")
      }
      setModalMode(null)
      await load()
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : "No fue posible guardar el registro.",
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setError("")

    try {
      await catedraticosService.remove(deleteTarget.id)
      setNotice("El registro se eliminó correctamente.")
      setDeleteTarget(null)
      await load()
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible eliminar el registro.",
      )
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <section className="rounded-2xl border border-line bg-white">
        <div className="flex flex-col justify-between gap-4 border-b border-line p-5 sm:flex-row sm:items-center sm:p-6">
          <div>
            <h2 className="text-lg font-bold">Directorio docente</h2>
            <p className="mt-1 text-sm text-muted">
              {loading ? "Consultando registros..." : `${items.length} catedráticos registrados`}
            </p>
          </div>
          <button
            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-bold text-white transition hover:bg-brand-dark"
            onClick={openCreate}
            type="button"
          >
            <span className="text-lg leading-none">+</span>
            Registrar catedrático
          </button>
        </div>

        <div className="border-b border-line p-5 sm:p-6">
          <label className="relative block max-w-md">
            <span className="sr-only">Buscar catedrático</span>
            <svg
              aria-hidden="true"
              className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              viewBox="0 0 24 24"
            >
              <path d="m21 21-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" />
            </svg>
            <input
              className="h-11 w-full rounded-xl border border-line bg-canvas/40 pr-4 pl-10 text-sm outline-none transition placeholder:text-muted/60 focus:border-brand-soft focus:bg-white focus:ring-4 focus:ring-brand-soft/10"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por nombre, correo o especialidad..."
              type="search"
              value={query}
            />
          </label>
        </div>

        {notice && (
          <div className="mx-5 mt-5 flex items-center justify-between gap-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 sm:mx-6">
            <span>{notice}</span>
            <button
              aria-label="Cerrar mensaje"
              className="font-bold"
              onClick={() => setNotice("")}
              type="button"
            >
              ×
            </button>
          </div>
        )}

        {error && (
          <div className="mx-5 mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:mx-6">
            {error}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[54rem] text-left">
            <thead>
              <tr className="border-b border-line bg-canvas/45 text-[0.68rem] font-bold uppercase tracking-wider text-muted">
                <th className="px-6 py-3.5">Catedrático</th>
                <th className="px-4 py-3.5">Contacto</th>
                <th className="px-4 py-3.5">Especialidad</th>
                <th className="px-4 py-3.5">Estado</th>
                <th className="px-6 py-3.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {loading &&
                Array.from({ length: 4 }).map((_, index) => (
                  <tr key={index}>
                    <td className="px-6 py-5" colSpan={5}>
                      <div className="h-8 animate-pulse rounded-lg bg-line/45" />
                    </td>
                  </tr>
                ))}
              {!loading &&
                filteredItems.map((item) => (
                  <tr className="transition hover:bg-canvas/45" key={item.id}>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft/10 text-xs font-bold text-brand-soft">
                          {initials(item)}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-ink">{fullName(item)}</p>
                          <p className="mt-0.5 text-xs text-muted">ID {item.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <p className="text-sm text-ink">{item.email}</p>
                      <p className="mt-1 text-xs text-muted">{item.telefono || "Sin teléfono"}</p>
                    </td>
                    <td className="px-4 py-4 text-sm text-muted">
                      {item.especialidad || "Sin especificar"}
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge tone={item.activo === false ? "neutral" : "success"}>
                        {item.activo === false ? "Inactivo" : "Activo"}
                      </StatusBadge>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          className="rounded-lg border border-line px-3 py-2 text-xs font-bold text-muted transition hover:bg-canvas hover:text-ink"
                          onClick={() => openDetails(item, "view")}
                          type="button"
                        >
                          Ver
                        </button>
                        <button
                          className="rounded-lg border border-brand-soft/25 px-3 py-2 text-xs font-bold text-brand-soft transition hover:bg-brand-soft/5"
                          onClick={() => openDetails(item, "edit")}
                          type="button"
                        >
                          Editar
                        </button>
                        <button
                          aria-label={`Eliminar a ${fullName(item)}`}
                          className="rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-600 transition hover:bg-red-50"
                          onClick={() => setDeleteTarget(item)}
                          type="button"
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {!loading && filteredItems.length === 0 && (
          <div className="px-6 py-16 text-center">
            <div className="mx-auto grid size-12 place-items-center rounded-full bg-canvas text-xl text-muted">
              ⌀
            </div>
            <p className="mt-4 text-sm font-bold text-ink">No se encontraron catedráticos</p>
            <p className="mt-1 text-xs text-muted">
              {query ? "Prueba con otro criterio de búsqueda." : "Registra el primer catedrático."}
            </p>
          </div>
        )}
      </section>

      <Modal
        description={
          modalMode === "edit"
            ? "Modifica únicamente los campos permitidos por la API."
            : "Completa los datos requeridos del nuevo docente."
        }
        onClose={() => setModalMode(null)}
        open={modalMode === "create" || modalMode === "edit"}
        title={modalMode === "edit" ? "Editar catedrático" : "Registrar catedrático"}
      >
        <form onSubmit={handleSubmit}>
          <div className="grid gap-5 px-6 py-6 sm:grid-cols-2">
            <Field
              defaultValue={selected?.nombre}
              label="Nombre"
              name="nombre"
              placeholder="Nombre"
              required
            />
            <Field
              defaultValue={selected?.apellido}
              label="Apellido"
              name="apellido"
              placeholder="Apellido"
              required
            />
            <div className="sm:col-span-2">
              <Field
                defaultValue={selected?.email}
                label="Correo electrónico"
                name="email"
                placeholder="docente@institucion.edu"
                required
                type="email"
              />
            </div>
            <Field
              defaultValue={selected?.telefono}
              label="Teléfono"
              name="telefono"
              placeholder="Número de contacto"
            />
            <Field
              defaultValue={selected?.especialidad}
              label="Especialidad"
              name="especialidad"
              placeholder="Área académica"
            />
          </div>
          {error && (
            <div className="mx-6 mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-3 border-t border-line bg-canvas/45 px-6 py-4">
            <button
              className="rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-bold text-muted"
              disabled={saving}
              onClick={() => setModalMode(null)}
              type="button"
            >
              Cancelar
            </button>
            <button
              className="rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark disabled:cursor-wait disabled:opacity-60"
              disabled={saving}
              type="submit"
            >
              {saving ? "Guardando..." : modalMode === "edit" ? "Guardar cambios" : "Registrar"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        onClose={() => setModalMode(null)}
        open={modalMode === "view" && Boolean(selected)}
        title="Información del catedrático"
      >
        {selected && (
          <div className="px-6 py-6">
            <div className="flex items-center gap-4">
              <div className="grid size-14 place-items-center rounded-full bg-brand-soft/10 text-base font-bold text-brand-soft">
                {initials(selected)}
              </div>
              <div>
                <p className="text-lg font-bold">{fullName(selected)}</p>
                <StatusBadge tone={selected.activo === false ? "neutral" : "success"}>
                  {selected.activo === false ? "Inactivo" : "Activo"}
                </StatusBadge>
              </div>
            </div>
            <dl className="mt-7 grid gap-5 rounded-xl bg-canvas/60 p-5 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-muted">Correo</dt>
                <dd className="mt-1 text-sm text-ink">{selected.email}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-muted">Teléfono</dt>
                <dd className="mt-1 text-sm text-ink">{selected.telefono || "No registrado"}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-muted">Especialidad</dt>
                <dd className="mt-1 text-sm text-ink">
                  {selected.especialidad || "No registrada"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-muted">Cuenta</dt>
                <dd className="mt-1 text-sm text-ink">
                  {selected.usuarioId ? `Usuario ${selected.usuarioId}` : "Sin cuenta vinculada"}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        confirming={deleting}
        message={
          deleteTarget
            ? `Se eliminará el registro de ${fullName(deleteTarget)}. Esta acción no se puede deshacer.`
            : ""
        }
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        open={Boolean(deleteTarget)}
        title="¿Eliminar catedrático?"
      />
    </>
  )
}
