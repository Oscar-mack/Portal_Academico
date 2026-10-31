import { apiRequest, withQuery } from "../lib/api"
import type { Nota } from "../types/api"

export interface AcademicIndicators {
  totalAlumnos: number
  totalNotasEvaluadas: number
  aprobados: number
  reprobados: number
  porcentajeAprobacion: number
  distribucionPorRango: Record<string, number>
  umbralAprobacion: number
}

export interface TeacherReport {
  catedratico: { id: number; nombre: string }
  totalNotas: number
  aprobados: number
  reprobados: number
  promedioGeneral: number
  notas: Nota[]
}

export const reportsService = {
  academicIndicators: (
    filters: {
      periodo?: string
      periodoAcademicoId?: number
      cursoId?: number
      gradoCarreraId?: number
    } = {},
  ) =>
    apiRequest<AcademicIndicators>(
      withQuery("/api/reportes/indicadores", filters),
    ),
  teacherReport: (
    catedraticoId: number,
    filters: { periodo?: string; periodoAcademicoId?: number } = {},
  ) =>
    apiRequest<TeacherReport>(
      withQuery(
        `/api/reportes/notas-por-catedratico/${catedraticoId}`,
        filters,
      ),
    ),
}
