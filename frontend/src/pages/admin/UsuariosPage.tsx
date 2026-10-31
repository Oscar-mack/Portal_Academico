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
import { catalogsService } from "../../services/catalogsService"
import { catedraticosService, type Catedratico } from "../../services/catedraticosService"
import type { Alumno, Usuario, UserRole } from "../../types/api"
import { FormActions, Notice } from "./GradosCarrerasPage"

const roleLabels: Record<UserRole, string> = {
  admin: "Administrador",
  catedratico: "Catedrático",
  alumno: "Alumno",
  padre: "Padre / tutor",
}

export default function UsuariosPage() {
  const [items, setItems] = useState<Usuario[]>([])
  const [students, setStudents] = useState<Alumno[]>([])
  const [teachers, setTeachers] = useState<Catedratico[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [roleFilter, setRoleFilter] = useState("")
  const [editor, setEditor] = useState<Usuario | "create" | null>(null)
  const [formRole, setFormRole] = useState<UserRole>("alumno")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const [users, studentRows, teacherRows] = await Promise.all([
        catalogsService.listUsers(),
        catalogsService.listStudents({ incluirInactivos: true }),
        catedraticosService.list(),
      ])
      setItems(users)
      setStudents(studentRows)
      setTeachers(teacherRows)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible consultar los usuarios.")
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
        (!roleFilter || item.rol === roleFilter) &&
        (!term ||
          item.username.toLowerCase().includes(term) ||
          item.email.toLowerCase().includes(term)),
    )
  }, [items, query, roleFilter])

  function openCreate() {
    setError("")
    setFormRole("alumno")
    setEditor("create")
  }

  function openEdit(user: Usuario) {
    setError("")
    setFormRole(user.rol)
    setEditor(user)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const item = editor === "create" ? null : editor
    setSaving(true)
    setError("")

    try {
      if (item) {
        await catalogsService.updateUser(item.id, {
          username: String(form.get("username") ?? "").trim(),
          email: String(form.get("email") ?? "").trim(),
          rol: String(form.get("rol")) as UserRole,
          activo: form.get("activo") === "true",
        })
        setNotice("El usuario se actualizó correctamente.")
      } else {
        const input = {
          username: String(form.get("username") ?? "").trim(),
          email: String(form.get("email") ?? "").trim(),
          password: String(form.get("password") ?? ""),
          rol: formRole,
          ...(formRole === "catedratico" && form.get("catedraticoId")
            ? { catedraticoId: Number(form.get("catedraticoId")) }
            : {}),
          ...(formRole === "alumno" && form.get("alumnoId")
            ? { alumnoId: Number(form.get("alumnoId")) }
            : {}),
          ...(formRole === "padre"
            ? {
                alumnoIds: form
                  .getAll("alumnoIds")
                  .map(Number)
                  .filter((value) => Number.isInteger(value)),
              }
            : {}),
        }
        await catalogsService.createUser(input)
        setNotice("La cuenta se creó correctamente.")
      }
      setEditor(null)
      await load()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible guardar la cuenta.")
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
            onClick={openCreate}
            type="button"
          >
            + Crear usuario
          </button>
        }
        count={loading ? "Consultando usuarios..." : `${items.length} cuentas`}
        description="La creación de cuentas está disponible exclusivamente para administradores."
        title="Usuarios"
      >
        <FilterBar
          onSearchChange={setQuery}
          placeholder="Buscar por usuario o correo..."
          search={query}
        >
          <SelectInput
            aria-label="Filtrar por rol"
            className="sm:max-w-56"
            onChange={(event) => setRoleFilter(event.target.value)}
            value={roleFilter}
          >
            <option value="">Todos los roles</option>
            {Object.entries(roleLabels).map(([role, label]) => (
              <option key={role} value={role}>
                {label}
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
                <th className="px-6 py-3.5">Usuario</th>
                <th className="px-4 py-3.5">Correo</th>
                <th className="px-4 py-3.5">Rol</th>
                <th className="px-4 py-3.5">Estado</th>
                <th className="px-4 py-3.5">Último acceso</th>
                <th className="px-6 py-3.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visibleItems.map((user) => (
                <tr className="hover:bg-canvas/40" key={user.id}>
                  <td className="px-6 py-4">
                    <p className="text-sm font-bold">{user.username}</p>
                    <p className="mt-0.5 text-xs text-muted">ID {user.id}</p>
                  </td>
                  <td className="px-4 py-4 text-sm text-muted">{user.email}</td>
                  <td className="px-4 py-4">
                    <StatusBadge tone="info">{roleLabels[user.rol]}</StatusBadge>
                  </td>
                  <td className="px-4 py-4">
                    <StatusBadge tone={user.activo ? "success" : "neutral"}>
                      {user.activo ? "Activo" : "Inactivo"}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-4 text-xs text-muted">
                    {user.ultimoLogin
                      ? new Intl.DateTimeFormat("es-GT", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(user.ultimoLogin))
                      : "Sin acceso registrado"}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      className="rounded-lg border border-brand-soft/25 px-3 py-2 text-xs font-bold text-brand-soft hover:bg-brand-soft/5"
                      onClick={() => openEdit(user)}
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
          <EmptyState description="No hay usuarios que coincidan con los filtros." title="Sin usuarios" />
        )}
      </AdminPage>

      <Modal
        description={
          item
            ? "La contraseña no se modifica desde este formulario."
            : "No existe registro público; esta cuenta será creada por un administrador."
        }
        onClose={() => setEditor(null)}
        open={Boolean(editor)}
        title={item ? "Editar usuario" : "Crear usuario"}
      >
        <form onSubmit={submit}>
          <div className="grid gap-5 px-6 py-6 sm:grid-cols-2">
            <FormField label="Nombre de usuario">
              <TextInput defaultValue={item?.username} name="username" required />
            </FormField>
            <FormField label="Correo electrónico">
              <TextInput defaultValue={item?.email} name="email" required type="email" />
            </FormField>
            {!item && (
              <div className="sm:col-span-2">
                <FormField hint="Debe contener al menos 8 caracteres." label="Contraseña temporal">
                  <TextInput minLength={8} name="password" required type="password" />
                </FormField>
              </div>
            )}
            <FormField label="Rol">
              <SelectInput
                name="rol"
                onChange={(event) => setFormRole(event.target.value as UserRole)}
                value={formRole}
              >
                {Object.entries(roleLabels).map(([role, label]) => (
                  <option key={role} value={role}>
                    {label}
                  </option>
                ))}
              </SelectInput>
            </FormField>
            {item && (
              <FormField label="Estado">
                <SelectInput defaultValue={String(item.activo)} name="activo">
                  <option value="true">Activo</option>
                  <option value="false">Inactivo</option>
                </SelectInput>
              </FormField>
            )}
            {!item && formRole === "catedratico" && (
              <div className="sm:col-span-2">
                <FormField label="Perfil de catedrático">
                  <SelectInput name="catedraticoId">
                    <option value="">Crear cuenta sin vincular perfil</option>
                    {teachers.map((teacher) => (
                      <option key={teacher.id} value={teacher.id}>
                        {teacher.nombre} {teacher.apellido} · {teacher.email}
                      </option>
                    ))}
                  </SelectInput>
                </FormField>
              </div>
            )}
            {!item && formRole === "alumno" && (
              <div className="sm:col-span-2">
                <FormField label="Perfil de alumno">
                  <SelectInput name="alumnoId">
                    <option value="">Crear cuenta sin vincular perfil</option>
                    {students.map((student) => (
                      <option key={student.id} value={student.id}>
                        {student.nombre} {student.apellido} · {student.email}
                      </option>
                    ))}
                  </SelectInput>
                </FormField>
              </div>
            )}
            {!item && formRole === "padre" && (
              <div className="sm:col-span-2">
                <FormField
                  hint="Usa Ctrl o Cmd para seleccionar más de un estudiante."
                  label="Estudiantes vinculados"
                >
                  <select
                    className="min-h-32 w-full rounded-xl border border-line bg-white p-3 text-sm outline-none focus:border-brand-soft focus:ring-4 focus:ring-brand-soft/10"
                    multiple
                    name="alumnoIds"
                  >
                    {students.map((student) => (
                      <option key={student.id} value={student.id}>
                        {student.nombre} {student.apellido} · {student.email}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>
            )}
          </div>
          <FormActions
            error={error}
            label={item ? "Guardar cambios" : "Crear cuenta"}
            onCancel={() => setEditor(null)}
            saving={saving}
          />
        </form>
      </Modal>
    </>
  )
}
