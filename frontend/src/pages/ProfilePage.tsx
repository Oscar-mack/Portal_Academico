import AdminPage from "../components/AdminPage"
import type { AuthUser } from "../lib/api"

export default function ProfilePage({ user }: { user: AuthUser }) {
  const values = [
    ["Nombre", [user.nombre, user.apellido].filter(Boolean).join(" ") || "No disponible"],
    ["Correo", user.correo || "No disponible"],
    ["Rol", user.rol],
    ["Usuario ID", String(user.id ?? "No disponible")],
    [
      user.rol === "catedratico" ? "Catedrático ID" : "Alumno ID",
      String(user.catedraticoId ?? user.alumnoId ?? "No aplica"),
    ],
  ]
  return (
    <AdminPage
      count="Información proporcionada por la sesión autenticada"
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
      <div className="border-t border-line bg-brand-soft/5 px-5 py-4 text-xs leading-5 text-muted sm:px-6">
        La API no expone una operación de edición de perfil para esta vista.
      </div>
    </AdminPage>
  )
}
