import { apiRequest, withQuery } from "../lib/api"

export interface AcademicFile {
  id: number
  nombreOriginal: string
  mimeType: string
  sizeBytes: number
  createdAt?: string
}

export interface AcademicTask {
  id: number
  cursoId: number
  periodoAcademicoId: number
  titulo: string
  descripcion: string
  instrucciones: string
  fechaPublicacion: string
  fechaLimite: string
  activo: boolean
  curso?: { id: number; nombre: string; codigo: string }
  periodoAcademico?: { id: number; nombre: string; estado: string }
  adjuntos?: AcademicFile[]
  estadoEntrega?: "pendiente" | "entregada" | "vencida"
  miEntrega?: (AcademicFile & { entregadaEn: string }) | null
}

export interface TaskSubmission {
  alumno: { id: number; nombre: string; apellido: string; email?: string }
  estado: "pendiente" | "entregada" | "vencida"
  entrega: { id: number; entregadaEn: string; archivo: AcademicFile } | null
}

export interface CourseMaterial {
  id: number
  cursoId: number
  periodoAcademicoId: number
  titulo: string
  descripcion: string
  activo: boolean
  curso?: { id: number; nombre: string; codigo: string }
  periodoAcademico?: { id: number; nombre: string }
  archivo: AcademicFile
}

export interface TaskInput {
  cursoId: number
  periodoAcademicoId: number
  titulo: string
  descripcion: string
  instrucciones: string
  fechaPublicacion: string
  fechaLimite: string
}

export const academicWorkService = {
  listTasks: (filters: {
    cursoId?: number
    periodoAcademicoId?: number
    estado?: string
  } = {}) => apiRequest<AcademicTask[]>(withQuery("/api/tareas", filters)),
  createTask: (input: TaskInput) =>
    apiRequest<AcademicTask>("/api/tareas", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateTask: (id: number, input: Partial<TaskInput>) =>
    apiRequest<AcademicTask>(`/api/tareas/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  deactivateTask: (id: number) =>
    apiRequest<{ message: string }>(`/api/tareas/${id}`, { method: "DELETE" }),
  attachTaskFile: (id: number, data: FormData) =>
    apiRequest(`/api/tareas/${id}/adjuntos`, { method: "POST", body: data }),
  submitTask: (id: number, data: FormData) =>
    apiRequest(`/api/tareas/${id}/entregas`, { method: "POST", body: data }),
  listSubmissions: (id: number) =>
    apiRequest<TaskSubmission[]>(`/api/tareas/${id}/entregas`),
  listMaterials: (filters: { cursoId?: number; periodoAcademicoId?: number } = {}) =>
    apiRequest<CourseMaterial[]>(withQuery("/api/materiales", filters)),
  createMaterial: (courseId: number, periodId: number, data: FormData) =>
    apiRequest<CourseMaterial>(
      withQuery(`/api/materiales/cursos/${courseId}`, {
        periodoAcademicoId: periodId,
      }),
      { method: "POST", body: data },
    ),
  deactivateMaterial: (id: number) =>
    apiRequest<{ message: string }>(`/api/materiales/${id}`, {
      method: "DELETE",
    }),
  async downloadFile(id: number) {
    const result = await apiRequest<{ url: string }>(
      `/api/archivos-academicos/${id}/descarga`,
    )
    window.location.assign(result.url)
  },
}
