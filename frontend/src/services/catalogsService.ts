import { apiRequest, withQuery } from "../lib/api"
import type { UserRole } from "../lib/api"
import type {
  Alumno,
  ApiMessage,
  Curso,
  GradoCarrera,
  Usuario,
  UsuarioInput,
} from "../types/api"

export interface GradoCarreraInput {
  nombre: string
  nivel?: string
  descripcion?: string
  activo?: boolean
}

export interface CursoInput {
  nombre: string
  codigo: string
  creditos?: number
  gradoCarreraId: number
  activo?: boolean
}

export interface AlumnoInput {
  nombre: string
  apellido: string
  email: string
  telefono?: string
  gradoCarreraId: number
  activo?: boolean
}

export const catalogsService = {
  listGrades: (incluirInactivos = false) =>
    apiRequest<GradoCarrera[]>(
      withQuery("/api/grados-carreras", { incluirInactivos }),
    ),
  createGrade: (input: GradoCarreraInput) =>
    apiRequest<GradoCarrera>("/api/grados-carreras", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateGrade: (id: number, input: GradoCarreraInput) =>
    apiRequest<ApiMessage>(`/api/grados-carreras/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  listCourses: (incluirInactivos = false) =>
    apiRequest<Curso[]>(withQuery("/api/cursos", { incluirInactivos })),
  getCourse: (id: number) => apiRequest<Curso>(`/api/cursos/${id}`),
  createCourse: (input: CursoInput) =>
    apiRequest<Curso>("/api/cursos", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateCourse: (id: number, input: CursoInput) =>
    apiRequest<ApiMessage>(`/api/cursos/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  listStudents: (filters: { gradoCarreraId?: number; incluirInactivos?: boolean } = {}) =>
    apiRequest<Alumno[]>(withQuery("/api/alumnos", filters)),
  getStudent: (id: number) => apiRequest<Alumno>(`/api/alumnos/${id}`),
  createStudent: (input: AlumnoInput) =>
    apiRequest<Alumno>("/api/alumnos", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateStudent: (id: number, input: AlumnoInput) =>
    apiRequest<ApiMessage>(`/api/alumnos/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  listUsers: (rol?: UserRole | "") =>
    apiRequest<Usuario[]>(withQuery("/api/usuarios", { rol })),
  getUser: (id: number) => apiRequest<Usuario>(`/api/usuarios/${id}`),
  createUser: (input: UsuarioInput) =>
    apiRequest<ApiMessage & { id: number; rol: UserRole }>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateUser: (
    id: number,
    input: Partial<Pick<Usuario, "username" | "email" | "rol" | "activo">>,
  ) =>
    apiRequest<ApiMessage>(`/api/usuarios/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
}
