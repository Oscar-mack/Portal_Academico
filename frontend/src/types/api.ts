import type { UserRole } from "../lib/api"
export type { UserRole } from "../lib/api"

export interface GradoCarrera {
  id: number
  nombre: string
  nivel?: string
  descripcion?: string
  activo: boolean
}

export interface Alumno {
  id: number
  nombre: string
  apellido: string
  email: string
  telefono?: string
  gradoCarreraId: number
  activo: boolean
  gradoCarrera?: GradoCarrera
  cursos?: Curso[]
}

export interface Catedratico {
  id: number
  nombre: string
  apellido: string
  email: string
  telefono?: string
  especialidad?: string
  activo: boolean
}

export interface Usuario {
  id: number
  username: string
  email: string
  rol: UserRole
  activo: boolean
  ultimoLogin?: string | null
  perfilCatedratico?: Catedratico | null
  perfilAlumno?: Alumno | null
}

export interface UsuarioInput {
  username: string
  email: string
  password: string
  rol: UserRole
  catedraticoId?: number
  alumnoId?: number
  alumnoIds?: number[]
}

export interface Curso {
  id: number
  nombre: string
  codigo: string
  creditos: number
  gradoCarreraId: number
  activo: boolean
  gradoCarrera?: GradoCarrera
}

export interface AsignacionCurso {
  id: number
  alumnoId: number
  cursoId: number
  periodo: string
  periodoAcademicoId?: number | null
  alumno?: Alumno
  curso?: Curso
}

export type WeekDay =
  | "Lunes"
  | "Martes"
  | "Miercoles"
  | "Jueves"
  | "Viernes"
  | "Sabado"

export interface HorarioCatedratico {
  id: number
  catedraticoId: number
  cursoId: number
  dia: WeekDay
  horaInicio: string
  horaFin: string
  periodo: string
  periodoAcademicoId?: number | null
  catedratico?: Catedratico
  curso?: Curso
}

export type AcademicState = "abierto" | "cerrado"
export type PeriodType = "bimestre" | "trimestre" | "semestre"

export interface CicloAcademico {
  id: number
  nombre: string
  fechaInicio: string
  fechaFin: string
  estado: AcademicState
  periodos?: PeriodoAcademico[]
}

export interface CicloAcademicoInput {
  nombre: string
  fechaInicio: string
  fechaFin: string
}

export interface CicloAcademicoUpdate extends Partial<CicloAcademicoInput> {
  estado?: AcademicState
}

export interface PeriodoAcademico {
  id: number
  cicloAcademicoId: number
  nombre: string
  tipo: PeriodType
  fechaInicio: string
  fechaFin: string
  estado: AcademicState
  cicloAcademico?: CicloAcademico
}

export interface PeriodoAcademicoInput {
  cicloAcademicoId: number
  nombre: string
  tipo: PeriodType
  fechaInicio: string
  fechaFin: string
}

export interface PeriodoAcademicoUpdate
  extends Partial<Omit<PeriodoAcademicoInput, "cicloAcademicoId">> {
  estado?: AcademicState
}

export interface Evaluacion {
  id: number
  cursoId: number
  catedraticoId: number
  periodoAcademicoId: number
  nombre: string
  puntajeMaximo: number | string
  activo: boolean
}

export interface EvaluacionInput {
  cursoId: number
  periodoAcademicoId: number
  nombre: string
  puntajeMaximo: number
  catedraticoId?: number
}

export interface CalificacionEvaluacion {
  id: number
  evaluacionId: number
  alumnoId: number
  valor: number | string
  alumno?: Alumno
}

export interface GradeSaveResponse {
  calificacion: CalificacionEvaluacion
  notaFinal: Nota | null
  consolidada: boolean
}

export interface Nota {
  id: number
  alumnoId: number
  cursoId: number
  catedraticoId: number
  valor: number
  estado: "aprobado" | "reprobado"
  periodo: string
  periodoAcademicoId?: number | null
  publicadaEn?: string | null
  alumno?: Alumno
  curso?: Curso
  catedratico?: Catedratico
}

export interface AuditoriaNota {
  id: number
  notaId: number
  usuarioId: number
  valorAnterior?: number | string | null
  valorNuevo: number | string
  motivo?: string | null
  createdAt: string
}

export type CargoState = "pendiente" | "parcial" | "pagado" | "vencido" | "anulado"
export type PaymentState = "pendiente" | "pagado" | "fallido" | "cancelado"
export type CurrencyCode = "GTQ" | "USD"

export interface Pago {
  id: number
  alumnoId: number
  cargoId?: number | null
  concepto: string
  monto: number | string
  moneda: string
  estado: PaymentState
  metodoPago: string
  fechaPago?: string | null
  createdAt: string
  alumno?: Alumno
}

export interface Cargo {
  id: number
  alumnoId: number
  concepto: string
  descripcion?: string | null
  montoOriginal: number | string
  montoPagado: number
  saldoPendiente: number
  moneda: CurrencyCode
  fechaEmision: string
  fechaVencimiento?: string | null
  cicloAcademicoId?: number | null
  periodoAcademicoId?: number | null
  anuladoEn?: string | null
  motivoAnulacion?: string | null
  estado: CargoState
  pagos: Pago[]
  alumno?: Alumno
}

export interface Solvencia {
  alumnoId: number
  solvente: boolean
  conciliacionHistoricaRequerida: boolean
  pagosHistoricosSinCargo: Record<
    string,
    { cantidad: number; montoPagado: number; montoPendiente: number }
  >
  saldoPendiente: number | null
  saldoPendientePorMoneda: Record<string, number>
  cargosPendientes: Cargo[]
}

export interface RequisitoSolvencia {
  id: number
  tipoDocumento: string
  requiereSolvencia: boolean
}

export interface StudentDashboardSummary {
  alumno: Pick<Alumno, "id" | "nombre" | "apellido" | "gradoCarreraId">
  totalCursos: number
  cursos: Curso[]
  totalNotasPublicadas: number
  promedioNotasPublicadas: number
  aprobados: number
  reprobados: number
  cargosPendientes: Cargo[]
  saldoPendientePorMoneda: Record<string, number>
}

export interface AdminDashboard {
  rol: "admin"
  resumen: {
    alumnosActivos: number
    catedraticosActivos: number
    cursosActivos: number
    notasPublicadas: number
    cargosPendientes: number
    saldoPendientePorMoneda: Record<string, number>
  }
}

export interface TeacherDashboard {
  rol: "catedratico"
  resumen: {
    cursosAsignados: number
    alumnosInscritos: number
    notasPublicadas: number
  }
  cursos: Array<{
    id: number
    nombre: string
    dia: string
    horaInicio: string
    horaFin: string
    periodoAcademicoId?: number | null
  }>
}

export interface StudentDashboard extends StudentDashboardSummary {
  rol: "alumno"
}

export interface ParentDashboard {
  rol: "padre"
  resumen: { alumnosVinculados: number }
  alumnos: StudentDashboardSummary[]
}

export type DashboardResponse =
  | AdminDashboard
  | TeacherDashboard
  | StudentDashboard
  | ParentDashboard

export interface LinkedStudent {
  vinculoId: number
  parentesco?: string
  alumno: Alumno
}

export interface ApiMessage {
  message: string
}

export interface CheckoutResponse {
  pagoId: number
  sessionId: string
  url: string
  reutilizado?: boolean
}

export interface RoleNavigationContract {
  role: UserRole
  canManageAcademicPeriods: boolean
  canManageEvaluations: boolean
  canManageCharges: boolean
}
