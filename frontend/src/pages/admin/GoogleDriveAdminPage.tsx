import { useCallback, useEffect, useState } from "react"
import { ApiError, apiRequest, AuthUser } from "../../lib/api"
import { callbackMessage, describeFolderCreation } from "./googleDriveAdminState.mjs"

interface GoogleDriveStatus {
  oauthConfigured: boolean
  encryptionKeyConfigured: boolean
  environmentTokenReadOnly: boolean
  authorized: boolean
  folder: {
    configured: boolean
    accessible: boolean
    id?: string
    name?: string
  }
}

function errorMessage(error: unknown) {
  return error instanceof ApiError || error instanceof Error
    ? error.message
    : "No fue posible completar la operación."
}

export default function GoogleDriveAdminPage({
  user,
  callbackResult,
}: {
  user: AuthUser
  callbackResult: string | null
}) {
  const [status, setStatus] = useState<GoogleDriveStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [createdFolder, setCreatedFolder] = useState<{ id: string; persisted: boolean } | null>(null)

  const loadStatus = useCallback(async () => {
    setError("")
    try {
      const currentStatus = await apiRequest<GoogleDriveStatus>("/api/auth/google/estado", {
        credentials: "include",
      })
      setStatus(currentStatus)
      return currentStatus
    } catch (reason) {
      setError(errorMessage(reason))
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!callbackResult) void loadStatus()
  }, [callbackResult, loadStatus])

  useEffect(() => {
    if (callbackResult === "authorized") {
      setError("")
      setMessage(callbackMessage(callbackResult))
      void loadStatus().then((currentStatus) => {
        if (currentStatus?.authorized) {
          setMessage("La autorización de Google está confirmada por el backend.")
        } else {
          setMessage("")
          setError("El backend no confirmó la autorización de Google. Inicia el proceso de nuevo.")
        }
      })
    } else if (callbackResult !== null) {
      setMessage("")
      setError(callbackMessage(callbackResult))
    }
  }, [callbackResult, loadStatus])

  useEffect(() => {
    if (!createdFolder) return
    if (status?.folder.accessible && status.folder.id === createdFolder.id) {
      setMessage("La carpeta está creada, configurada y accesible para las cargas del portal.")
      setCreatedFolder(null)
    } else if (createdFolder.persisted) {
      setMessage("La carpeta se creó y su identificador quedó guardado, pero el backend aún no confirma que esté accesible para las cargas.")
    } else {
      setMessage("La carpeta se creó en Google Drive, pero todavía no está configurada para las cargas. Añade el identificador a GOOGLE_DRIVE_FOLDER_ID en Render y actualiza el estado.")
    }
  }, [createdFolder, status])

  async function startAuthorization() {
    setWorking(true)
    setError("")
    setMessage("Autorización pendiente: abriendo Google…")
    try {
      const result = await apiRequest<{ authorizationUrl?: unknown }>("/api/auth/google/iniciar", {
        method: "POST",
        credentials: "include",
      })
      if (typeof result.authorizationUrl !== "string") {
        throw new Error("El servidor no devolvió la dirección de autorización.")
      }
      const authorizationUrl = new URL(result.authorizationUrl)
      const apiOrigin = new URL(import.meta.env.VITE_API_URL ?? "", window.location.origin).origin
      // El backend devuelve su propia URL de lanzamiento: así las cookies OAuth se fijan en una
      // navegación de primer nivel hacia su dominio y luego redirige a Google.
      if (
        authorizationUrl.origin !== apiOrigin ||
        authorizationUrl.pathname !== "/api/auth/google/autorizar" ||
        authorizationUrl.hash
      ) {
        throw new Error("El servidor devolvió una dirección de autorización no válida.")
      }
      window.location.assign(authorizationUrl.href)
    } catch (reason) {
      setMessage("")
      setError(errorMessage(reason))
      setWorking(false)
    }
  }

  async function createFolder() {
    setWorking(true)
    setError("")
    setMessage("")
    try {
      const result = await apiRequest<unknown>("/api/auth/google/carpeta", {
        method: "POST",
        credentials: "include",
        body: JSON.stringify({}),
      })
      const feedback = describeFolderCreation(result)
      setCreatedFolder({ id: feedback.id, persisted: feedback.persisted })
      setMessage(feedback.message)
      await loadStatus()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setWorking(false)
    }
  }

  if (user.rol !== "admin") {
    return (
      <section className="rounded-2xl border border-line bg-white p-6 text-sm text-muted">
        Esta función está disponible únicamente para administradores.
      </section>
    )
  }

  const authorized = status?.authorized === true
  const folderAccessible = status?.folder.accessible === true

  return (
    <section className="max-w-3xl rounded-2xl border border-line bg-white p-6 shadow-sm sm:p-8">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-soft">
        Integración de ensayo
      </p>
      <h2 className="mt-2 font-display text-2xl font-medium">Google Drive</h2>
      <p className="mt-2 text-sm leading-6 text-muted">
        Autoriza la cuenta Google del propietario y crea una carpeta para los archivos de ensayo.
        No se muestran ni se guardan credenciales en el navegador.
      </p>
      {status?.environmentTokenReadOnly && (
        <p className="mt-4 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          El token cifrado está configurado como solo lectura. Para renovar la autorización, hay que
          completar el flujo localmente y actualizar manualmente la variable cifrada; el portal no
          puede modificar la configuración de Render.
        </p>
      )}

      <div className="mt-6 rounded-xl border border-line bg-canvas/60 p-4" aria-live="polite">
        {loading ? (
          <p className="text-sm text-muted">Consultando el estado de autorización…</p>
        ) : (
          <>
            <p className="text-sm font-semibold">
              Autorización:{" "}
              <span className={authorized ? "text-emerald-700" : "text-amber-700"}>
                {authorized ? "Autorizada" : "Pendiente"}
              </span>
            </p>
            <p className="mt-2 text-sm font-semibold">
              Carpeta:{" "}
              {folderAccessible
                ? `Accesible${status?.folder.name ? ` · ${status.folder.name}` : ""}`
                : "No configurada o inaccesible"}
            </p>
          </>
        )}
        {message && <p className="mt-3 text-sm text-brand-soft">{message}</p>}
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
        {createdFolder && !(status?.folder.accessible && status.folder.id === createdFolder.id) && (
          <p className="mt-3 text-sm text-muted">
            Identificador de la carpeta creada: <code className="break-all font-mono">{createdFolder.id}</code>
          </p>
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={loading || working || !status?.oauthConfigured || !status.encryptionKeyConfigured || status.environmentTokenReadOnly}
          onClick={() => void startAuthorization()}
          type="button"
        >
          {working ? "Procesando…" : authorized ? "Volver a autorizar" : "Autorizar con Google"}
        </button>
        <button
          className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50"
          disabled={loading || working || !authorized || folderAccessible}
          onClick={() => void createFolder()}
          type="button"
        >
          Crear carpeta de ensayo
        </button>
        <button
          className="rounded-xl px-4 py-2.5 text-sm font-semibold text-brand-soft transition hover:bg-brand-soft/5 disabled:opacity-50"
          disabled={loading || working}
          onClick={() => void loadStatus()}
          type="button"
        >
          Actualizar estado
        </button>
      </div>
      <p className="mt-5 text-xs leading-5 text-muted">
        La autorización requiere volver al portal desde el callback de Google. Si el servicio está
        configurado con un token cifrado de solo lectura, el backend indicará que la renovación debe
        prepararse localmente.
      </p>
    </section>
  )
}
