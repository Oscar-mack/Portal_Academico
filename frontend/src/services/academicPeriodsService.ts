import { apiRequest, withQuery } from "../lib/api"
import type {
  CicloAcademico,
  CicloAcademicoInput,
  CicloAcademicoUpdate,
  PeriodoAcademico,
  PeriodoAcademicoInput,
  PeriodoAcademicoUpdate,
} from "../types/api"

export const academicPeriodsService = {
  listCycles: () => apiRequest<CicloAcademico[]>("/api/ciclos"),
  createCycle: (input: CicloAcademicoInput) =>
    apiRequest<CicloAcademico>("/api/ciclos", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateCycle: (id: number, input: CicloAcademicoUpdate) =>
    apiRequest<CicloAcademico>(`/api/ciclos/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  listPeriods: (filters: { cicloAcademicoId?: number; estado?: string } = {}) =>
    apiRequest<PeriodoAcademico[]>(withQuery("/api/periodos", filters)),
  createPeriod: (input: PeriodoAcademicoInput) =>
    apiRequest<PeriodoAcademico>("/api/periodos", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updatePeriod: (id: number, input: PeriodoAcademicoUpdate) =>
    apiRequest<PeriodoAcademico>(`/api/periodos/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
}
