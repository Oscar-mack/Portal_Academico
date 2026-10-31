import { apiRequest } from "../lib/api"

export interface Catedratico {
  id: number
  nombre: string
  apellido: string
  email: string
  telefono?: string
  especialidad?: string
  usuarioId?: number | null
  activo?: boolean
}

export interface CatedraticoInput {
  nombre: string
  apellido: string
  email: string
  telefono?: string
  especialidad?: string
}

export const catedraticosService = {
  list: () => apiRequest<Catedratico[]>("/api/catedraticos"),
  get: (id: number) => apiRequest<Catedratico>(`/api/catedraticos/${id}`),
  create: (data: CatedraticoInput) =>
    apiRequest<Catedratico>("/api/catedraticos", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: number, data: CatedraticoInput) =>
    apiRequest<{ message: string }>(`/api/catedraticos/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  remove: (id: number) =>
    apiRequest<{ message: string }>(`/api/catedraticos/${id}`, {
      method: "DELETE",
    }),
}
