export type UserRole = "admin" | "catedratico" | "alumno" | "padre"

export interface AuthUser {
  id?: number | string
  nombre?: string
  apellido?: string
  correo?: string
  rol: UserRole
  catedraticoId?: number | string
  alumnoId?: number | string
  raw: Record<string, unknown>
}

type JsonRecord = Record<string, unknown>

const API_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "")
const TOKEN_KEY = "portal_academico_token"

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readRecord(value: unknown, key: string): JsonRecord | undefined {
  if (!isRecord(value)) return undefined
  const nested = value[key]
  return isRecord(nested) ? nested : undefined
}

function readString(value: unknown, keys: string[]): string | undefined {
  if (!isRecord(value)) return undefined

  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === "string" && candidate.trim()) return candidate
  }

  return undefined
}

function readId(value: unknown, keys: string[]): number | string | undefined {
  if (!isRecord(value)) return undefined

  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === "string" || typeof candidate === "number") return candidate
  }

  return undefined
}

export function normalizeRole(value: unknown): UserRole | null {
  if (typeof value !== "string") return null
  const role = value.toLowerCase().trim()

  if (role === "admin" || role === "administrador") return "admin"
  if (role === "catedratico" || role === "catedrático" || role === "docente") {
    return "catedratico"
  }
  if (role === "alumno" || role === "estudiante") return "alumno"
  if (role === "padre" || role === "tutor" || role === "padre/tutor") return "padre"

  return null
}

export function normalizeUser(payload: unknown): AuthUser {
  const data = readRecord(payload, "data") ?? (isRecord(payload) ? payload : {})
  const source = readRecord(data, "usuario") ?? readRecord(data, "user") ?? data
  const role = normalizeRole(source.rol ?? source.role ?? data.rol ?? data.role)

  if (!role) {
    throw new ApiError("La cuenta no tiene un rol reconocido por el portal.", 403)
  }

  const catedratico =
    readRecord(source, "perfilCatedratico") ?? readRecord(source, "catedratico")
  const alumno = readRecord(source, "perfilAlumno") ?? readRecord(source, "alumno")

  return {
    id: readId(source, ["id", "usuarioId", "userId"]),
    nombre: readString(source, ["nombre", "name", "nombres", "username"]),
    apellido: readString(source, ["apellido", "lastName", "apellidos"]),
    correo: readString(source, ["correo", "email"]),
    rol: role,
    catedraticoId:
      readId(source, ["catedraticoId"]) ?? readId(catedratico, ["id", "catedraticoId"]),
    alumnoId: readId(source, ["alumnoId"]) ?? readId(alumno, ["id", "alumnoId"]),
    raw: source,
  }
}

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY)
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY)
  // Remove tokens created by earlier development versions of the portal.
  localStorage.removeItem(TOKEN_KEY)
}

async function parseResponse(response: Response) {
  const contentType = response.headers.get("content-type") ?? ""

  if (contentType.includes("application/json")) {
    return response.json()
  }

  if (contentType.includes("application/pdf")) {
    return response.blob()
  }

  const text = await response.text()
  return text ? { message: text } : null
}

export async function apiRequest<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (!API_URL) {
    throw new ApiError("La URL del backend no está configurada.", 0)
  }

  const token = getToken()
  const headers = new Headers(options.headers)

  if (!(options.body instanceof FormData) && options.body) {
    headers.set("Content-Type", "application/json")
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`)
  }

  let response: Response

  try {
    response = await fetch(`${API_URL}${path}`, { ...options, headers })
  } catch {
    throw new ApiError(
      "No fue posible conectar con el servidor: la solicitud no recibió respuesta HTTP. Verifica que la API esté activa y que CORS_ORIGIN incluya el origen del portal. Los errores 401, 403 y 404 se informan por separado.",
      0,
    )
  }

  const payload = await parseResponse(response)

  if (!response.ok) {
    const serverMessage = readString(payload, ["message", "error", "mensaje"])
    throw new ApiError(
      describeHttpError(response.status, serverMessage, path),
      response.status,
    )
  }

  return payload as T
}

function describeHttpError(
  status: number,
  serverMessage: string | undefined,
  path: string,
) {
  const endpoint = path.split("?")[0]

  // El 404 genérico de Express significa que la ruta no existe en el backend publicado.
  if (status === 404 && serverMessage && /^ruta no encontrada/i.test(serverMessage)) {
    return `El servidor no tiene disponible el servicio ${endpoint} (404). El backend publicado parece desactualizado respecto al portal; solicita al administrador técnico verificar el despliegue.`
  }
  if (status === 502 || status === 503 || status === 504) {
    return `El servidor no está disponible temporalmente (${status}). Espera unos segundos y reintenta.`
  }
  return (
    serverMessage ?? `La solicitud no pudo completarse (${status}).`
  )
}

export function withQuery(
  path: string,
  params: Record<string, string | number | boolean | null | undefined>,
) {
  const search = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value))
    }
  }

  const query = search.toString()
  return query ? `${path}?${query}` : path
}

export async function downloadApiFile(path: string) {
  const blob = await apiRequest<Blob>(path)
  if (!(blob instanceof Blob)) {
    throw new ApiError("El servidor no devolvió el archivo esperado.", 500)
  }
  return blob
}

export async function signIn(username: string, password: string) {
  const payload = await apiRequest<JsonRecord>("/api/auth/signin", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  })
  const data = readRecord(payload, "data")
  const token =
    readString(payload, ["token", "accessToken", "access_token"]) ??
    readString(data, ["token", "accessToken", "access_token"])

  if (!token) {
    throw new ApiError("El servidor no devolvió un token de acceso.", 500)
  }

  sessionStorage.setItem(TOKEN_KEY, token)
  return payload
}

export async function getProfile() {
  const payload = await apiRequest("/api/auth/perfil")
  return normalizeUser(payload)
}

export function asArray(payload: unknown): JsonRecord[] {
  if (Array.isArray(payload)) return payload.filter(isRecord)
  if (!isRecord(payload)) return []

  const candidates = [
    payload.data,
    payload.rows,
    payload.resultados,
    payload.items,
    payload.registros,
  ]

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.filter(isRecord)
  }

  return []
}

export function readNumber(payload: unknown, keys: string[]): number | null {
  if (!isRecord(payload)) return null
  const data = readRecord(payload, "data")

  for (const source of [payload, data]) {
    if (!source) continue
    for (const key of keys) {
      const value = source[key]
      if (typeof value === "number" && Number.isFinite(value)) return value
      if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
        return Number(value)
      }
    }
  }

  return null
}

export function displayName(user: AuthUser) {
  const fullName = [user.nombre, user.apellido].filter(Boolean).join(" ")
  return fullName || user.correo || "Usuario"
}
