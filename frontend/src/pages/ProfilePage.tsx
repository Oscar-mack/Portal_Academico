import { useEffect, useState } from "react"
import AdminPage from "../components/AdminPage"
import ErrorState from "../components/ErrorState"
import LoadingState from "../components/LoadingState"
import type { AuthUser } from "../lib/api"
import { familyService } from "../services/familyService"
import type { LinkedStudent } from "../types/api"

function LinkedStudents({ userId }: { userId: AuthUser["id"] }) {
  const [students, setStudents] = useState<LinkedStudent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    setStudents([])
    setLoading(true)
    setError("")
    familyService.getMyStudents()
      .then((links) => {
        if (active) setStudents(links)
      })
      .catch((requestError) => {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "No fue posible consultar los estudiantes vinculados.",
          )
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [userId, retry])

  return (
    <section className="border-t border-line p-5 sm:p-6">
      <h2 className="text-base font-bold">Estudiantes vinculados</h2>
      {loading ? (
        <LoadingState rows={1} />
      ) : error ? (
        <div className="mt-4">
          <ErrorState message={error} onRetry={() => setRetry((value) => value + 1)} />
        </div>
      ) : students.length ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {students.map(({ vinculoId, alumno, parentesco }) => (
            <div className="rounded-xl border border-line bg-canvas/35 p-4" key={vinculoId}>
              <p className="text-sm font-bold text-ink">
                {[alumno.nombre, alumno.apellido].filter(Boolean).join(" ")}
              </p>
              <p className="mt-2 text-xs text-muted">Alumno ID: {alumno.id}</p>
              {alumno.gradoCarrera?.nombre && (
                <p className="mt-1 text-xs text-muted">
                  Grado o carrera: {alumno.gradoCarrera.nombre}
                </p>
              )}
              {parentesco && <p className="mt-1 text-xs text-muted">Parentesco: {parentesco}</p>}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">No hay estudiantes vinculados a esta cuenta.</p>
      )}
    </section>
  )
}

export default function ProfilePage({ user }: { user: AuthUser }) {
  const values = [
    ["Nombre", [user.nombre, user.apellido].filter(Boolean).join(" ") || "No disponible"],
    ["Correo", user.correo || "No disponible"],
    ["Rol", user.rol],
    ["Usuario ID", String(user.id ?? "No disponible")],
  ]
  if (user.rol === "catedratico") {
    values.push(["Catedrático ID", String(user.catedraticoId ?? user.alumnoId ?? "No aplica")])
  } else if (user.rol !== "padre") {
    values.push(["Alumno ID", String(user.alumnoId ?? "No aplica")])
  }
  return (
    <AdminPage
      count={user.rol === "padre" ? "Datos de la cuenta y estudiantes vinculados" : "Información proporcionada por la sesión autenticada"}
      description="Datos básicos de la cuenta."
      title="Mi perfil"
    >
      <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
        {values.map(([label, value]) => (
          <div className="rounded-xl border border-line bg-canvas/35 p-4" key={label}>
            <p className="text-xs font-bold uppercase tracking-wide text-muted">
              {label}
            </p>
            <p className="mt-2 text-sm font-bold text-ink">{value}</p>
          </div>
        ))}
      </div>
      {user.rol === "padre" ? (
        <LinkedStudents key={user.id} userId={user.id} />
      ) : (
        <div className="border-t border-line bg-brand-soft/5 px-5 py-4 text-xs leading-5 text-muted sm:px-6">
          La API no expone una operación de edición de perfil para esta vista.
        </div>
      )}
    </AdminPage>
  )
}
