import { apiRequest, withQuery } from "../lib/api"
import type {
  ApiMessage,
  AsignacionCurso,
  HorarioCatedratico,
  OfertaCurso,
  WeekDay,
} from "../types/api"

export interface AssignmentFilters {
  alumnoId?: number
  cursoId?: number
  periodoAcademicoId?: number
  periodo?: string
}

export interface AssignmentInput {
  alumnoId: number
  cursoId: number
  periodoAcademicoId?: number | null
  periodo?: string
}

export interface ScheduleFilters {
  catedraticoId?: number
  cursoId?: number
  alumnoId?: number
  periodoAcademicoId?: number
  periodo?: string
}

export interface ScheduleInput {
  catedraticoId: number
  cursoId: number
  dia: WeekDay
  horaInicio: string
  horaFin: string
  periodoAcademicoId?: number
  ofertaCursoId?: number
  periodo?: string
}

export interface CourseOfferInput {
  cursoId: number
  catedraticoId: number
  periodoAcademicoId: number
  codigoSeccion: string
  cupoMaximo: number
  fechaInscripcionInicio: string
  fechaInscripcionFin: string
}

export const academicAssignmentsService = {
  listAssignments: (filters: AssignmentFilters = {}) =>
    apiRequest<AsignacionCurso[]>(
      withQuery("/api/asignaciones-curso", { ...filters }),
    ),
  getAssignment: (id: number) =>
    apiRequest<AsignacionCurso>(`/api/asignaciones-curso/${id}`),
  createAssignment: (input: AssignmentInput) =>
    apiRequest<AsignacionCurso>("/api/asignaciones-curso", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateAssignment: (id: number, input: AssignmentInput) =>
    apiRequest<AsignacionCurso>(`/api/asignaciones-curso/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  listSchedules: (filters: ScheduleFilters = {}) =>
    apiRequest<HorarioCatedratico[]>(
      withQuery("/api/horarios-catedratico", { ...filters }),
    ),
  listCourseOffers: (periodoAcademicoId?: number) =>
    apiRequest<OfertaCurso[]>(
      withQuery("/api/ofertas-curso", { periodoAcademicoId }),
    ),
  listAvailableCourseOffers: (periodoAcademicoId: number) =>
    apiRequest<OfertaCurso[]>(
      withQuery("/api/ofertas-curso/disponibles", { periodoAcademicoId }),
    ),
  createCourseOffer: (input: CourseOfferInput) =>
    apiRequest<OfertaCurso>("/api/ofertas-curso", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateCourseOffer: (
    id: number,
    input: Partial<Pick<CourseOfferInput, "cupoMaximo" | "fechaInscripcionInicio" | "fechaInscripcionFin">> & { activo?: boolean },
  ) =>
    apiRequest<OfertaCurso>(`/api/ofertas-curso/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  enrollInCourseOffer: (ofertaCursoId: number) =>
    apiRequest<AsignacionCurso>("/api/asignaciones-curso", {
      method: "POST",
      body: JSON.stringify({ ofertaCursoId }),
    }),
  getSchedule: (id: number) =>
    apiRequest<HorarioCatedratico>(`/api/horarios-catedratico/${id}`),
  createSchedule: (input: ScheduleInput) =>
    apiRequest<HorarioCatedratico>("/api/horarios-catedratico", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateSchedule: (
    id: number,
    input: Pick<ScheduleInput, "dia" | "horaInicio" | "horaFin">,
  ) =>
    apiRequest<HorarioCatedratico>(`/api/horarios-catedratico/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  assignmentMessage: (message: string) => ({ message }) as ApiMessage,
}
