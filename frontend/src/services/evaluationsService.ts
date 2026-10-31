import { apiRequest, withQuery } from "../lib/api"
import type {
  ApiMessage,
  CalificacionEvaluacion,
  Evaluacion,
  EvaluacionInput,
  GradeSaveResponse,
} from "../types/api"

export const evaluationsService = {
  list: (filters: { cursoId?: number; periodoAcademicoId?: number } = {}) =>
    apiRequest<Evaluacion[]>(withQuery("/api/evaluaciones", filters)),
  create: (input: EvaluacionInput) =>
    apiRequest<Evaluacion>("/api/evaluaciones", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  update: (id: number, input: Pick<Partial<EvaluacionInput>, "nombre" | "puntajeMaximo">) =>
    apiRequest<Evaluacion>(`/api/evaluaciones/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  deactivate: (id: number) =>
    apiRequest<ApiMessage & { id: number }>(`/api/evaluaciones/${id}`, {
      method: "DELETE",
    }),
  listGrades: (id: number) =>
    apiRequest<CalificacionEvaluacion[]>(`/api/evaluaciones/${id}/calificaciones`),
  saveGrade: (
    id: number,
    input: { alumnoId: number; valor: number; motivo?: string },
  ) =>
    apiRequest<GradeSaveResponse>(`/api/evaluaciones/${id}/calificaciones`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
}
