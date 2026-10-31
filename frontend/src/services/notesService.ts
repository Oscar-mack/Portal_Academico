import { apiRequest, downloadApiFile, withQuery } from "../lib/api"
import type { ApiMessage, AuditoriaNota, Nota } from "../types/api"

export interface NoteFilters {
  cursoId?: number
  periodo?: string
  periodoAcademicoId?: number
  alumnoId?: number
  catedraticoId?: number
}

export const notesService = {
  list: (filters: NoteFilters = {}) =>
    apiRequest<Nota[]>(withQuery("/api/notas", { ...filters })),
  get: (id: number) => apiRequest<Nota>(`/api/notas/${id}`),
  update: (id: number, input: { valor: number; motivo?: string }) =>
    apiRequest<ApiMessage & { nota: Nota }>(`/api/notas/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  publish: (id: number) =>
    apiRequest<ApiMessage & { id: number; publicadaEn: string }>(
      `/api/notas/${id}/publicar`,
      { method: "PATCH" },
    ),
  history: (id: number) =>
    apiRequest<AuditoriaNota[]>(`/api/notas/${id}/historial`),
  downloadReportCard: (
    alumnoId: number,
    filters: { periodo?: string; periodoAcademicoId?: number } = {},
  ) =>
    downloadApiFile(
      withQuery(`/api/reportes/boleta-pdf/${alumnoId}`, filters),
    ),
}
