import { lazy, Suspense, useEffect, useMemo, useState } from "react"
import AcademicPeriodSelector from "../components/AcademicPeriodSelector"
import { useAcademicPeriod } from "../context/AcademicPeriodContext"
import { ApiError, AuthUser, displayName, UserRole } from "../lib/api"
import { money } from "../lib/money"
import { dashboardService } from "../services/dashboardService"
import type { DashboardResponse } from "../types/api"

const AcademicPeriodsPage = lazy(() => import("./admin/AcademicPeriodsPage"))
const AcademicAssignmentsPage = lazy(() => import("./AcademicAssignmentsPage"))
const AcademicWorkPage = lazy(() => import("./AcademicWorkPage"))
const AlumnosPage = lazy(() => import("./admin/AlumnosPage"))
const CatedraticosPage = lazy(() => import("./admin/CatedraticosPage"))
const CursosPage = lazy(() => import("./admin/CursosPage"))
const DocumentsPage = lazy(() => import("./DocumentsPage"))
const EvaluationsPage = lazy(() => import("./EvaluationsPage"))
const FinancialModulePage = lazy(() => import("./FinancialModulePage"))
const GradosCarrerasPage = lazy(() => import("./admin/GradosCarrerasPage"))
const NotesPage = lazy(() => import("./NotesPage"))
const ProfilePage = lazy(() => import("./ProfilePage"))
const ReportsPage = lazy(() => import("./ReportsPage"))
const RoleDashboardHome = lazy(() => import("./RoleDashboardHome"))
const StudentEvaluationsPage = lazy(() => import("./StudentEvaluationsPage"))
const UsuariosPage = lazy(() => import("./admin/UsuariosPage"))
const SchedulesPage = lazy(() => import("./SchedulesPage"))

type IconName =
  | "home"
  | "teachers"
  | "students"
  | "courses"
  | "assignments"
  | "grades"
  | "reports"
  | "calendar"
  | "search"
  | "bell"
  | "logout"
  | "menu"
  | "payments"
  | "users"
  | "settings"
  | "profile"
  | "children"

function Icon({ name, className = "size-5" }: { name: IconName; className?: string }) {
  const paths: Record<IconName, React.ReactNode> = {
    home: (
      <>
        <path d="m3 11 9-8 9 8" />
        <path d="M5 10v11h14V10M9 21v-6h6v6" />
      </>
    ),
    teachers: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M16 11h6M19 8v6" />
      </>
    ),
    students: (
      <>
        <path d="m3 9 9-5 9 5-9 5-9-5Z" />
        <path d="M7 11v5c3 2 7 2 10 0v-5M21 9v6" />
      </>
    ),
    children: (
      <>
        <circle cx="9" cy="7" r="4" />
        <path d="M3 21v-2a6 6 0 0 1 12 0v2M17 8a3 3 0 1 1 0 6M18 17c2.2.4 3 1.8 3 4" />
      </>
    ),
    courses: (
      <>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
      </>
    ),
    assignments: (
      <>
        <rect width="14" height="18" x="5" y="3" rx="2" />
        <path d="M9 3V1h6v2M9 9h6M9 13h4" />
      </>
    ),
    grades: <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />,
    reports: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6M8 13h8M8 17h6" />
      </>
    ),
    calendar: (
      <>
        <rect width="18" height="18" x="3" y="4" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </>
    ),
    search: <path d="m21 21-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" />,
    bell: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </>
    ),
    logout: (
      <>
        <path d="M10 17l5-5-5-5M15 12H3" />
        <path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" />
      </>
    ),
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    payments: (
      <>
        <rect width="20" height="14" x="2" y="5" rx="2" />
        <path d="M2 10h20M6 15h2" />
      </>
    ),
    users: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="8.5" cy="7" r="4" />
        <path d="M18 8a3 3 0 0 1 0 6M23 21v-2a4 4 0 0 0-3-3.9" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V3h4v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    ),
    profile: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 22a8 8 0 0 1 16 0" />
      </>
    ),
  }

  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {paths[name]}
    </svg>
  )
}

interface NavItem {
  label: string
  icon: IconName
  endpoint?: string
}

interface RoleConfig {
  label: string
  eyebrow: string
  greeting: string
  description: string
  navigation: NavItem[]
  quickActions: NavItem[]
}

const roleConfigs: Record<UserRole, RoleConfig> = {
  admin: {
    label: "Administrador",
    eyebrow: "Gestión institucional",
    greeting: "Panel administrativo",
    description: "Supervisa la información académica y operativa de la institución.",
    navigation: [
      { label: "Resumen", icon: "home" },
      { label: "Ciclos y períodos", icon: "calendar", endpoint: "/api/ciclos" },
      { label: "Catedráticos", icon: "teachers", endpoint: "/api/catedraticos" },
      { label: "Alumnos", icon: "students", endpoint: "/api/alumnos" },
      { label: "Grados y carreras", icon: "courses", endpoint: "/api/grados-carreras" },
      { label: "Cursos", icon: "courses", endpoint: "/api/cursos" },
      { label: "Asignaciones", icon: "assignments", endpoint: "/api/asignaciones-curso" },
      { label: "Horarios docentes", icon: "calendar", endpoint: "/api/horarios-catedratico" },
      { label: "Evaluaciones", icon: "assignments", endpoint: "/api/evaluaciones" },
      { label: "Tareas y materiales", icon: "assignments", endpoint: "/api/tareas" },
      { label: "Control de notas", icon: "grades", endpoint: "/api/notas" },
      { label: "Reportes", icon: "reports", endpoint: "/api/reportes/indicadores" },
      { label: "Cargos y solvencia", icon: "payments", endpoint: "/api/cargos" },
      { label: "Pagos", icon: "payments", endpoint: "/api/pagos" },
      { label: "Documentos", icon: "reports", endpoint: "/api/reportes/boleta-pdf" },
      { label: "Usuarios", icon: "users", endpoint: "/api/usuarios" },
    ],
    quickActions: [
      { label: "Registrar alumno", icon: "students", endpoint: "/api/alumnos" },
      { label: "Registrar catedrático", icon: "teachers", endpoint: "/api/catedraticos" },
      { label: "Crear curso", icon: "courses", endpoint: "/api/cursos" },
      { label: "Registrar notas", icon: "grades", endpoint: "/api/notas" },
    ],
  },
  catedratico: {
    label: "Catedrático",
    eyebrow: "Espacio docente",
    greeting: "Mi jornada académica",
    description: "Consulta tus cursos, alumnos, horarios y calificaciones asignadas.",
    navigation: [
      { label: "Inicio", icon: "home" },
      { label: "Mis cursos", icon: "courses", endpoint: "/api/horarios-catedratico" },
      { label: "Mis alumnos", icon: "students", endpoint: "/api/alumnos" },
      { label: "Mi horario", icon: "calendar", endpoint: "/api/horarios-catedratico" },
      { label: "Evaluaciones", icon: "assignments", endpoint: "/api/evaluaciones" },
      { label: "Tareas", icon: "assignments", endpoint: "/api/tareas" },
      { label: "Calificaciones", icon: "grades", endpoint: "/api/evaluaciones" },
      { label: "Notas finales", icon: "grades", endpoint: "/api/notas" },
      { label: "Reportes", icon: "reports" },
      { label: "Documentos académicos", icon: "reports", endpoint: "/api/reportes/boleta-pdf" },
      { label: "Mi perfil", icon: "profile", endpoint: "/api/auth/perfil" },
    ],
    quickActions: [
      { label: "Registrar nota", icon: "grades", endpoint: "/api/notas" },
      { label: "Ver mis alumnos", icon: "students", endpoint: "/api/alumnos" },
      { label: "Consultar horario", icon: "calendar", endpoint: "/api/horarios-catedratico" },
      { label: "Ver reportes", icon: "reports" },
    ],
  },
  alumno: {
    label: "Alumno",
    eyebrow: "Mi espacio académico",
    greeting: "Mi portal estudiantil",
    description: "Consulta tus cursos, calificaciones, horarios y documentos académicos.",
    navigation: [
      { label: "Inicio", icon: "home" },
      { label: "Mis cursos", icon: "courses", endpoint: "/api/asignaciones-curso" },
      { label: "Evaluaciones", icon: "assignments", endpoint: "/api/evaluaciones" },
      { label: "Tareas", icon: "assignments", endpoint: "/api/tareas" },
      { label: "Mis calificaciones", icon: "grades", endpoint: "/api/notas" },
      { label: "Mi horario", icon: "calendar", endpoint: "/api/horarios-catedratico" },
      { label: "Boleta académica", icon: "reports" },
      { label: "Cargos y pagos", icon: "payments", endpoint: "/api/cargos" },
      { label: "Documentos", icon: "reports", endpoint: "/api/reportes/boleta-pdf" },
      { label: "Mi perfil", icon: "profile", endpoint: "/api/auth/perfil" },
    ],
    quickActions: [
      { label: "Ver calificaciones", icon: "grades", endpoint: "/api/notas" },
      { label: "Consultar cursos", icon: "courses", endpoint: "/api/asignaciones-curso" },
      { label: "Descargar boleta", icon: "reports" },
      { label: "Consultar pagos", icon: "payments", endpoint: "/api/pagos" },
    ],
  },
  padre: {
    label: "Padre / Tutor",
    eyebrow: "Seguimiento familiar",
    greeting: "Portal de padres",
    description: "Da seguimiento al rendimiento y los compromisos de tus estudiantes vinculados.",
    navigation: [
      { label: "Inicio", icon: "home" },
      {
        label: "Mis estudiantes",
        icon: "children",
        endpoint: "/api/padres-alumnos/mis-alumnos",
      },
      { label: "Calificaciones", icon: "grades", endpoint: "/api/notas" },
      { label: "Cursos", icon: "courses", endpoint: "/api/asignaciones-curso" },
      { label: "Horarios", icon: "calendar", endpoint: "/api/horarios-catedratico" },
      { label: "Boletas académicas", icon: "reports" },
      { label: "Cargos y pagos", icon: "payments", endpoint: "/api/cargos" },
      { label: "Documentos", icon: "reports", endpoint: "/api/reportes/boleta-pdf" },
      { label: "Mi perfil", icon: "profile", endpoint: "/api/auth/perfil" },
    ],
    quickActions: [
      {
        label: "Ver estudiantes",
        icon: "children",
        endpoint: "/api/padres-alumnos/mis-alumnos",
      },
      { label: "Ver calificaciones", icon: "grades", endpoint: "/api/notas" },
      { label: "Consultar pagos", icon: "payments", endpoint: "/api/pagos" },
      { label: "Descargar boleta", icon: "reports" },
    ],
  },
}

interface SummaryMetric {
  label: string
  value: string
  detail: string
  icon: IconName
  tone: string
}

interface SummaryState {
  metrics: SummaryMetric[]
  spotlight: {
    value: string
    label: string
    description: string
  } | null
  loaded: boolean
  warning?: string
}

const initialSummary: SummaryState = { metrics: [], spotlight: null, loaded: false }

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-ink">
        <Icon name="students" className="size-5" />
      </div>
      <div>
        <p className="text-sm font-bold tracking-tight text-white">Portal Académico</p>
        <p className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-white/45">
          Campus digital
        </p>
      </div>
    </div>
  )
}

function initials(user: AuthUser) {
  const values = [user.nombre, user.apellido].filter(Boolean)
  if (values.length) return values.map((value) => value?.[0]).join("").slice(0, 2).toUpperCase()
  return user.correo?.slice(0, 2).toUpperCase() ?? "US"
}

function metric(
  label: string,
  value: number | null,
  detail: string,
  icon: IconName,
  tone: string,
): SummaryMetric {
  return {
    label,
    value: value === null ? "—" : value.toLocaleString("es-GT"),
    detail,
    icon,
    tone,
  }
}

function formatBalances(balances: Record<string, number>) {
  const entries = Object.entries(balances)
  if (!entries.length) return "Sin saldo pendiente"
  return entries
    .map(([currency, amount]) =>
      money(currency, amount),
    )
    .join(" · ")
}

function parentAverage(payload: Extract<DashboardResponse, { rol: "padre" }>) {
  const noteCount = payload.alumnos.reduce(
    (total, student) => total + student.totalNotasPublicadas,
    0,
  )
  if (!noteCount) return null
  const weightedTotal = payload.alumnos.reduce(
    (total, student) =>
      total + student.promedioNotasPublicadas * student.totalNotasPublicadas,
    0,
  )
  return weightedTotal / noteCount
}

async function loadSummary(periodoAcademicoId?: number | null): Promise<SummaryState> {
  const payload = await dashboardService.get(periodoAcademicoId)

  if (payload.rol === "admin") {
    return {
      loaded: true,
      spotlight: {
        value: String(payload.resumen.notasPublicadas),
        label: "Notas publicadas",
        description: "Solo se contabilizan notas oficialmente publicadas.",
      },
      metrics: [
        metric("Alumnos activos", payload.resumen.alumnosActivos, "Perfiles activos", "students", "teal"),
        metric(
          "Catedráticos activos",
          payload.resumen.catedraticosActivos,
          "Equipo docente",
          "teachers",
          "blue",
        ),
        metric("Cursos activos", payload.resumen.cursosActivos, "Oferta académica", "courses", "amber"),
        metric(
          "Cargos pendientes",
          payload.resumen.cargosPendientes,
          formatBalances(payload.resumen.saldoPendientePorMoneda),
          "payments",
          "violet",
        ),
      ],
    }
  }

  if (payload.rol === "catedratico") {
    return {
      loaded: true,
      spotlight: {
        value: String(payload.resumen.notasPublicadas),
        label: "Notas publicadas",
        description: "Notas de tus cursos que ya son visibles para estudiantes y familias.",
      },
      metrics: [
        metric("Cursos asignados", payload.resumen.cursosAsignados, "En el período", "courses", "teal"),
        metric("Alumnos inscritos", payload.resumen.alumnosInscritos, "Sin duplicados", "students", "blue"),
        metric("Notas publicadas", payload.resumen.notasPublicadas, "Visibles oficialmente", "grades", "amber"),
        metric("Clases programadas", payload.cursos.length, "Bloques de horario", "calendar", "violet"),
      ],
    }
  }

  if (payload.rol === "alumno") {
    return {
      loaded: true,
      spotlight: {
        value: payload.promedioNotasPublicadas.toLocaleString("es-GT", {
          maximumFractionDigits: 2,
        }),
        label: "Promedio publicado",
        description: "Calculado por el backend únicamente con notas publicadas.",
      },
      metrics: [
        metric("Cursos inscritos", payload.totalCursos, "Asignaciones del período", "courses", "teal"),
        metric(
          "Notas publicadas",
          payload.totalNotasPublicadas,
          "Disponibles oficialmente",
          "grades",
          "blue",
        ),
        metric("Cursos aprobados", payload.aprobados, `${payload.reprobados} reprobados`, "reports", "amber"),
        metric(
          "Cargos pendientes",
          payload.cargosPendientes.length,
          formatBalances(payload.saldoPendientePorMoneda),
          "payments",
          "violet",
        ),
      ],
    }
  }

  const average = parentAverage(payload)
  const totalCourses = payload.alumnos.reduce((total, student) => total + student.totalCursos, 0)
  const totalNotes = payload.alumnos.reduce(
    (total, student) => total + student.totalNotasPublicadas,
    0,
  )
  const totalCharges = payload.alumnos.reduce(
    (total, student) => total + student.cargosPendientes.length,
    0,
  )

  return {
    loaded: true,
    spotlight: {
      value:
        average === null
          ? "—"
          : average.toLocaleString("es-GT", { maximumFractionDigits: 2 }),
      label: "Promedio familiar",
      description: "Promedio ponderado de las notas publicadas de estudiantes vinculados.",
    },
    metrics: [
      metric("Estudiantes vinculados", payload.resumen.alumnosVinculados, "Vínculos autorizados", "children", "teal"),
      metric("Cursos inscritos", totalCourses, "Todos los estudiantes", "courses", "blue"),
      metric("Notas publicadas", totalNotes, "Visibles para la familia", "grades", "amber"),
      metric("Cargos pendientes", totalCharges, "Consulta individual por estudiante", "payments", "violet"),
    ],
  }
}

function MetricCard({ item, loading }: { item: SummaryMetric; loading: boolean }) {
  const tones = {
    teal: "bg-brand-soft/10 text-brand-soft",
    blue: "bg-blue-500/10 text-blue-600",
    amber: "bg-amber-500/12 text-amber-700",
    violet: "bg-violet-500/10 text-violet-600",
  }

  return (
    <article className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(16,42,56,0.03)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-muted">{item.label}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-ink">
            {loading ? <span className="block h-9 w-16 animate-pulse rounded bg-line/60" /> : item.value}
          </p>
        </div>
        <div
          className={`grid size-11 place-items-center rounded-xl ${
            tones[item.tone as keyof typeof tones]
          }`}
        >
          <Icon name={item.icon} />
        </div>
      </div>
      <p className="mt-4 text-xs font-semibold text-brand-soft">{item.detail}</p>
    </article>
  )
}

export default function DashboardPage({
  user,
  onLogout,
}: {
  user: AuthUser
  onLogout: () => void
}) {
  const config = roleConfigs[user.rol]
  const {
    selectedPeriodId,
    selectedPeriod,
    loading: periodsLoading,
    error: periodError,
  } = useAcademicPeriod()
  const [activeNav, setActiveNav] = useState(config.navigation[0].label)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [dashboardPayload, setDashboardPayload] =
    useState<DashboardResponse | null>(null)
  const [fatalError, setFatalError] = useState("")

  useEffect(() => {
    if (periodsLoading) return

    let active = true
    setDashboardPayload(null)
    setFatalError("")

    dashboardService
      .get(selectedPeriodId)
      .then((payload) => {
        if (active) setDashboardPayload(payload)
      })
      .catch((error) => {
        if (!active) return
        if (error instanceof ApiError && error.status === 401) {
          onLogout()
          return
        }
        setFatalError(error instanceof Error ? error.message : "No fue posible cargar el portal.")
      })

    return () => {
      active = false
    }
  }, [selectedPeriodId, periodsLoading, onLogout])

  const activeItem = useMemo(
    () => config.navigation.find((item) => item.label === activeNav),
    [activeNav, config.navigation],
  )
  const userName = displayName(user)

  return (
    <div className="min-h-screen bg-canvas text-ink lg:grid lg:grid-cols-[16rem_1fr]">
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-brand px-4 py-6 transition-transform lg:translate-x-0 ${
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-2">
          <Brand />
        </div>
        <nav className="mt-9 flex-1 space-y-1 overflow-y-auto" aria-label="Navegación principal">
          {config.navigation.map((item) => {
            const active = activeNav === item.label
            return (
              <button
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${
                  active
                    ? "bg-white/12 text-white shadow-sm"
                    : "text-white/58 hover:bg-white/7 hover:text-white"
                }`}
                key={item.label}
                onClick={() => {
                  setActiveNav(item.label)
                  setMobileMenuOpen(false)
                }}
                type="button"
              >
                <Icon name={item.icon} className="size-[1.1rem]" />
                <span className="truncate">{item.label}</span>
                {active && <span className="ml-auto size-1.5 rounded-full bg-accent" />}
              </button>
            )
          })}
        </nav>
        <div className="border-t border-white/10 pt-4">
          <div className="mb-3 flex items-center gap-3 rounded-xl bg-white/6 p-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-ink">
              {initials(user)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-white">{userName}</p>
              <p className="truncate text-[0.68rem] text-white/45">{config.label}</p>
            </div>
          </div>
          <button
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-white/58 transition hover:bg-white/7 hover:text-white"
            onClick={onLogout}
            type="button"
          >
            <Icon name="logout" className="size-[1.1rem]" />
            Cerrar sesión
          </button>
        </div>
      </aside>

      {mobileMenuOpen && (
        <button
          aria-label="Cerrar menú"
          className="fixed inset-0 z-30 bg-ink/35 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
          type="button"
        />
      )}

      <div className="lg:col-start-2">
        <header className="sticky top-0 z-20 flex h-20 items-center gap-4 border-b border-line/80 bg-canvas/90 px-5 backdrop-blur-xl sm:px-8 lg:px-10">
          <button
            aria-label="Abrir menú"
            className="grid size-10 place-items-center rounded-xl border border-line bg-white text-ink lg:hidden"
            onClick={() => setMobileMenuOpen(true)}
            type="button"
          >
            <Icon name="menu" />
          </button>
          <div className="relative hidden max-w-md flex-1 sm:block">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-muted">
              <Icon name="search" className="size-[1.1rem]" />
            </span>
            <input
              aria-label="Búsqueda global no disponible"
              className="h-11 w-full cursor-not-allowed rounded-xl border border-line bg-white pr-4 pl-11 text-sm opacity-60 outline-none placeholder:text-muted/65"
              disabled
              placeholder="Búsqueda global pendiente de endpoint"
              type="search"
            />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <AcademicPeriodSelector />
            <button
              aria-label="Notificaciones no disponibles"
              className="grid size-10 cursor-not-allowed place-items-center rounded-xl border border-line bg-white text-muted opacity-50"
              disabled
              title="La API no expone notificaciones"
              type="button"
            >
              <Icon name="bell" className="size-[1.15rem]" />
            </button>
            <div className="hidden items-center gap-3 sm:flex">
              <div className="grid size-10 place-items-center rounded-full bg-brand text-xs font-bold text-white">
                {initials(user)}
              </div>
              <div className="hidden xl:block">
                <p className="max-w-40 truncate text-xs font-bold">{userName}</p>
                <p className="text-[0.68rem] text-muted">{config.label}</p>
              </div>
            </div>
          </div>
        </header>

        <main className="px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
          <div className="mx-auto max-w-[90rem]">
            <div className="mb-8">
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-brand-soft">
                {config.eyebrow}
              </p>
              <h1 className="font-display text-4xl font-medium tracking-tight sm:text-5xl">
                {activeNav === config.navigation[0].label ? config.greeting : activeNav}
              </h1>
              <p className="mt-2 text-sm text-muted">
                {activeNav === config.navigation[0].label
                  ? `${user.nombre ? `Hola, ${user.nombre}. ` : ""}${config.description}`
                  : "Este espacio utilizará exclusivamente la información autorizada para tu cuenta."}
              </p>
              {selectedPeriod && (
                <p className="mt-3 text-xs font-semibold text-brand-soft">
                  Mostrando {selectedPeriod.nombre} ·{" "}
                  {selectedPeriod.estado === "abierto" ? "período activo" : "período histórico"}
                </p>
              )}
            </div>

            {(fatalError || periodError) && (
              <div className="mb-6 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {fatalError || periodError}
              </div>
            )}

            <Suspense
              fallback={
                <section className="rounded-2xl border border-line bg-white p-6">
                  <div className="space-y-3">
                    <div className="h-12 animate-pulse rounded-xl bg-line/45" />
                    <div className="h-12 animate-pulse rounded-xl bg-line/45" />
                    <div className="h-12 animate-pulse rounded-xl bg-line/45" />
                  </div>
                </section>
              }
            >
              {activeNav === config.navigation[0].label ||
              (user.rol === "padre" && activeNav === "Mis estudiantes") ? (
              <RoleDashboardHome
                loading={!dashboardPayload && !fatalError}
                onNavigate={setActiveNav}
                payload={dashboardPayload}
                user={user}
              />
            ) : user.rol === "admin" && activeNav === "Ciclos y períodos" ? (
              <AcademicPeriodsPage />
            ) : user.rol === "admin" && activeNav === "Catedráticos" ? (
              <CatedraticosPage />
            ) : user.rol === "admin" && activeNav === "Alumnos" ? (
              <AlumnosPage />
            ) : user.rol === "admin" && activeNav === "Grados y carreras" ? (
              <GradosCarrerasPage />
            ) : user.rol === "admin" && activeNav === "Cursos" ? (
              <CursosPage />
            ) : user.rol === "admin" && activeNav === "Asignaciones" ? (
              <AcademicAssignmentsPage user={user} />
            ) : user.rol === "admin" && activeNav === "Horarios docentes" ? (
              <SchedulesPage user={user} />
            ) : user.rol === "admin" && activeNav === "Evaluaciones" ? (
              <EvaluationsPage user={user} />
            ) : user.rol === "admin" && activeNav === "Tareas y materiales" ? (
              <AcademicWorkPage user={user} />
            ) : user.rol === "admin" && activeNav === "Control de notas" ? (
              <NotesPage user={user} />
            ) : user.rol === "admin" && activeNav === "Reportes" ? (
              <ReportsPage user={user} />
            ) : user.rol === "admin" &&
              (activeNav === "Cargos y solvencia" ||
                activeNav === "Pagos") ? (
              <FinancialModulePage
                initialView={activeNav === "Pagos" ? "payments" : "charges"}
                user={user}
              />
            ) : user.rol === "admin" && activeNav === "Usuarios" ? (
              <UsuariosPage />
            ) : user.rol === "admin" && activeNav === "Documentos" ? (
              <DocumentsPage user={user} />
            ) : user.rol === "catedratico" && activeNav === "Mis alumnos" ? (
              <AcademicAssignmentsPage user={user} />
            ) : user.rol === "catedratico" &&
              (activeNav === "Mis cursos" || activeNav === "Mi horario") ? (
              <SchedulesPage user={user} />
            ) : user.rol === "catedratico" &&
              (activeNav === "Evaluaciones" || activeNav === "Calificaciones") ? (
              <EvaluationsPage user={user} />
            ) : user.rol === "catedratico" && activeNav === "Tareas" ? (
              <AcademicWorkPage user={user} />
            ) : user.rol === "catedratico" && activeNav === "Notas finales" ? (
              <NotesPage user={user} />
            ) : user.rol === "catedratico" && activeNav === "Reportes" ? (
              <ReportsPage user={user} />
            ) : user.rol === "catedratico" && activeNav === "Mi perfil" ? (
              <ProfilePage user={user} />
            ) : user.rol === "catedratico" &&
              activeNav === "Documentos académicos" ? (
              <DocumentsPage user={user} />
            ) : user.rol === "alumno" && activeNav === "Mis cursos" ? (
              <AcademicAssignmentsPage user={user} />
            ) : user.rol === "alumno" && activeNav === "Evaluaciones" ? (
              <StudentEvaluationsPage />
            ) : user.rol === "alumno" && activeNav === "Tareas" ? (
              <AcademicWorkPage user={user} />
            ) : user.rol === "alumno" && activeNav === "Mi horario" ? (
              <SchedulesPage user={user} />
            ) : user.rol === "alumno" &&
              (activeNav === "Mis calificaciones" ||
                activeNav === "Boleta académica") ? (
              <NotesPage user={user} />
            ) : user.rol === "alumno" && activeNav === "Cargos y pagos" ? (
              <FinancialModulePage user={user} />
            ) : user.rol === "alumno" && activeNav === "Mi perfil" ? (
              <ProfilePage user={user} />
            ) : user.rol === "alumno" && activeNav === "Documentos" ? (
              <DocumentsPage user={user} />
            ) : user.rol === "padre" && activeNav === "Cursos" ? (
              <AcademicAssignmentsPage user={user} />
            ) : user.rol === "padre" && activeNav === "Horarios" ? (
              <SchedulesPage user={user} />
            ) : user.rol === "padre" &&
              (activeNav === "Calificaciones" ||
                activeNav === "Boletas académicas") ? (
              <NotesPage user={user} />
            ) : user.rol === "padre" && activeNav === "Cargos y pagos" ? (
              <FinancialModulePage user={user} />
            ) : user.rol === "padre" && activeNav === "Mi perfil" ? (
              <ProfilePage user={user} />
            ) : user.rol === "padre" && activeNav === "Documentos" ? (
              <DocumentsPage user={user} />
            ) : (
              <section className="rounded-2xl border border-line bg-white p-6 sm:p-8">
                <div className="grid min-h-80 place-items-center rounded-xl border border-dashed border-line bg-canvas/45 px-6 text-center">
                  <div className="max-w-md">
                    <div className="mx-auto grid size-12 place-items-center rounded-xl bg-brand-soft/10 text-brand-soft">
                      <Icon name={activeItem?.icon ?? "reports"} />
                    </div>
                    <h2 className="mt-5 text-lg font-bold">{activeNav}</h2>
                    <p className="mt-2 text-sm leading-6 text-muted">
                      El módulo está incluido en la navegación y respetará los permisos del rol{" "}
                      {config.label.toLowerCase()}.
                    </p>
                    {activeItem?.endpoint ? (
                      <p className="mt-4 rounded-lg bg-brand-soft/6 px-3 py-2 font-mono text-xs text-brand-soft">
                        Fuente: {activeItem.endpoint}
                      </p>
                    ) : (
                      <p className="mt-4 text-xs font-semibold text-amber-700">
                        Esta función requiere completar o confirmar su endpoint.
                      </p>
                    )}
                    <p className="mt-4 text-xs text-muted">
                      La tabla, filtros y formularios de esta sección se implementarán en la
                      siguiente etapa del módulo.
                    </p>
                  </div>
                </div>
              </section>
              )}
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  )
}
