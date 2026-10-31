import { useCallback, useEffect, useMemo, useState } from "react"
import AdminPage from "../components/AdminPage"
import EmptyState from "../components/EmptyState"
import ErrorState from "../components/ErrorState"
import { SelectInput } from "../components/FormField"
import LoadingState from "../components/LoadingState"
import StatusBadge from "../components/StatusBadge"
import { useAcademicPeriod } from "../context/AcademicPeriodContext"
import type { AuthUser } from "../lib/api"
import { downloadBlob } from "../lib/download"
import { academicAssignmentsService } from "../services/academicAssignmentsService"
import { catalogsService } from "../services/catalogsService"
import { familyService } from "../services/familyService"
import { financeService } from "../services/financeService"
import { notesService } from "../services/notesService"
import type { RequisitoSolvencia, Solvencia } from "../types/api"
import { Notice } from "./admin/GradosCarrerasPage"

interface DocumentStudent {
  id: number
  nombre: string
  apellido: string
}

type DocumentIcon = "academic" | "financial" | "shield"

function DocumentIcon({ name }: { name: DocumentIcon }) {
  const paths: Record<DocumentIcon, React.ReactNode> = {
    academic: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6M8 13h8M8 17h6" />
      </>
    ),
    financial: (
      <>
        <rect height="14" rx="2" width="20" x="2" y="5" />
        <path d="M2 10h20M6 15h2" />
      </>
    ),
    shield: (
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
  }
  return (
    <svg
      aria-hidden="true"
      className="size-6"
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

function fullName(student?: DocumentStudent) {
  return student
    ? `${student.nombre} ${student.apellido}`
    : "Selecciona un alumno"
}

function money(currency: string, value: number) {
  return new Intl.NumberFormat("es-GT", {
    style: "currency",
    currency,
  }).format(value)
}

function DocumentCard({
  name,
  description,
  category,
  student,
  icon,
  available,
  loading,
  action,
  onAction,
}: {
  name: string
  description: string
  category: string
  student?: DocumentStudent
  icon: DocumentIcon
  available: boolean
  loading: boolean
  action: string
  onAction?: () => void
}) {
  return (
    <article className="flex h-full flex-col rounded-2xl border border-line bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <span className="grid size-12 place-items-center rounded-xl bg-brand-soft/10 text-brand-soft">
          <DocumentIcon name={icon} />
        </span>
        <StatusBadge tone={available ? "success" : "neutral"}>
          {available ? "Disponible" : "No disponible"}
        </StatusBadge>
      </div>
      <p className="mt-5 text-xs font-bold uppercase tracking-wide text-brand-soft">
        {category}
      </p>
      <h3 className="mt-1 text-lg font-bold text-ink">{name}</h3>
      <p className="mt-2 flex-1 text-sm leading-6 text-muted">{description}</p>
      <div className="mt-5 border-t border-line pt-4">
        <p className="text-xs text-muted">Alumno relacionado</p>
        <p className="mt-1 truncate text-sm font-bold">{fullName(student)}</p>
      </div>
      <button
        className="mt-4 h-11 rounded-xl bg-brand px-4 text-sm font-bold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
        disabled={!available || loading || !onAction}
        onClick={onAction}
        type="button"
      >
        {loading ? "Preparando documento..." : action}
      </button>
    </article>
  )
}

const futureCapabilities = [
  "Solicitudes de certificados",
  "Emisión y firma digital",
  "Almacenamiento documental",
  "Verificación pública y códigos QR",
  "Historial de certificados",
  "Documentos administrativos",
  "Notificaciones de disponibilidad",
]

export default function DocumentsPage({ user }: { user: AuthUser }) {
  const { selectedPeriodId, selectedPeriod } = useAcademicPeriod()
  const financialAccess =
    user.rol === "admin" || user.rol === "alumno" || user.rol === "padre"
  const [students, setStudents] = useState<DocumentStudent[]>([])
  const [studentId, setStudentId] = useState("")
  const [solvency, setSolvency] = useState<Solvencia | null>(null)
  const [requirements, setRequirements] = useState<RequisitoSolvencia[]>([])
  const [loading, setLoading] = useState(true)
  const [solvencyLoading, setSolvencyLoading] = useState(false)
  const [downloading, setDownloading] = useState<
    "report-card" | "account" | null
  >(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [refreshKey, setRefreshKey] = useState(0)

  const effectiveStudentId =
    Number(studentId) || Number(user.alumnoId) || undefined
  const selectedStudent = useMemo(
    () => students.find((student) => student.id === effectiveStudentId),
    [effectiveStudentId, students],
  )

  const loadStudents = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      if (user.rol === "admin") {
        const rows = await catalogsService.listStudents({
          incluirInactivos: true,
        })
        setStudents(rows)
        setStudentId("")
      } else if (user.rol === "padre") {
        const links = await familyService.getMyStudents()
        const rows = links.map((link) => link.alumno)
        setStudents(rows)
        setStudentId(String(rows[0]?.id ?? ""))
      } else if (user.rol === "catedratico") {
        const assignments =
          await academicAssignmentsService.listAssignments({
            periodoAcademicoId: selectedPeriodId ?? undefined,
          })
        const rows = Array.from(
          new Map(
            assignments
              .filter((assignment) => assignment.alumno)
              .map((assignment) => [
                assignment.alumnoId,
                assignment.alumno as DocumentStudent,
              ]),
          ).values(),
        )
        setStudents(rows)
        setStudentId(String(rows[0]?.id ?? ""))
      } else if (user.alumnoId) {
        setStudents([
          {
            id: Number(user.alumnoId),
            nombre: user.nombre ?? "Alumno",
            apellido: user.apellido ?? "",
          },
        ])
        setStudentId(String(user.alumnoId))
      } else {
        setStudents([])
        setStudentId("")
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible consultar los alumnos autorizados.",
      )
    } finally {
      setLoading(false)
    }
  }, [
    selectedPeriodId,
    user.alumnoId,
    user.apellido,
    user.nombre,
    user.rol,
  ])

  useEffect(() => {
    loadStudents()
  }, [loadStudents])

  useEffect(() => {
    if (!financialAccess) {
      setRequirements([])
      setSolvency(null)
      return
    }
    let active = true
    setSolvencyLoading(true)
    setSolvency(null)
    setError("")
    Promise.all([
      financeService.listRequirements(),
      effectiveStudentId
        ? financeService.getSolvency(effectiveStudentId)
        : Promise.resolve(null),
    ])
      .then(([requirementRows, solvencyResult]) => {
        if (!active) return
        setRequirements(requirementRows)
        setSolvency(solvencyResult)
      })
      .catch((requestError) => {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "No fue posible consultar la solvencia documental.",
          )
        }
      })
      .finally(() => {
        if (active) setSolvencyLoading(false)
      })
    return () => {
      active = false
    }
  }, [effectiveStudentId, financialAccess, refreshKey])

  async function download(kind: "report-card" | "account") {
    if (!effectiveStudentId) return
    setDownloading(kind)
    setError("")
    try {
      const blob =
        kind === "report-card"
          ? await notesService.downloadReportCard(effectiveStudentId, {
              periodoAcademicoId: selectedPeriodId ?? undefined,
            })
          : await financeService.downloadAccountStatement(
              effectiveStudentId,
              { periodoAcademicoId: selectedPeriodId ?? undefined },
            )
      downloadBlob(
        blob,
        kind === "report-card"
          ? `boleta-alumno-${effectiveStudentId}.pdf`
          : `estado-cuenta-alumno-${effectiveStudentId}.pdf`,
      )
      setNotice(
        kind === "report-card"
          ? "La boleta oficial se descargó correctamente."
          : "El estado de cuenta se descargó correctamente.",
      )
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible descargar el documento.",
      )
    } finally {
      setDownloading(null)
    }
  }

  return (
    <AdminPage
      count={
        selectedPeriod
          ? `Documentos del período ${selectedPeriod.nombre}`
          : "Documentos de todos los períodos disponibles"
      }
      description="Consulta y descarga exclusivamente documentos emitidos por el backend institucional."
      title="Centro de documentos"
    >
      <div className="flex flex-col justify-between gap-4 border-b border-line p-5 sm:flex-row sm:items-center sm:p-6">
        <div>
          <p className="text-sm font-bold text-ink">Alumno relacionado</p>
          <p className="mt-1 text-xs text-muted">
            La API valida nuevamente el acceso al generar cada documento.
          </p>
        </div>
        {user.rol === "alumno" ? (
          <div className="rounded-xl bg-brand-soft/8 px-4 py-3 text-sm font-bold text-brand">
            {fullName(selectedStudent)}
          </div>
        ) : (
          <SelectInput
            aria-label="Seleccionar alumno para documentos"
            className="sm:max-w-80"
            disabled={loading || !students.length}
            onChange={(event) => setStudentId(event.target.value)}
            value={studentId}
          >
            {user.rol === "admin" && (
              <option value="">Selecciona un alumno</option>
            )}
            {students.map((student) => (
              <option key={student.id} value={student.id}>
                {fullName(student)}
              </option>
            ))}
          </SelectInput>
        )}
      </div>

      {notice && <Notice message={notice} onClose={() => setNotice("")} />}
      {error && (
        <div className="mx-5 mt-5 sm:mx-6">
          <ErrorState
            message={error}
            onRetry={() => {
              setRefreshKey((value) => value + 1)
              loadStudents()
            }}
          />
        </div>
      )}

      {loading ? (
        <LoadingState rows={4} />
      ) : !students.length && user.rol !== "admin" ? (
        <EmptyState
          description="No hay alumnos autorizados para consultar documentos en este período."
          title="Sin documentos disponibles"
        />
      ) : (
        <div className="space-y-8 p-5 sm:p-6">
          <section>
            <div className="mb-4">
              <p className="text-xs font-bold uppercase tracking-widest text-brand-soft">
                Documentos académicos
              </p>
              <h2 className="mt-1 text-lg font-bold">Información académica oficial</h2>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <DocumentCard
                action="Descargar boleta PDF"
                available={Boolean(effectiveStudentId)}
                category="Académico"
                description="Boleta oficial de calificaciones generada por el backend para el alumno y período seleccionados."
                icon="academic"
                loading={downloading === "report-card"}
                name="Boleta de calificaciones"
                onAction={
                  effectiveStudentId
                    ? () => download("report-card")
                    : undefined
                }
                student={selectedStudent}
              />
              <article className="flex h-full flex-col rounded-2xl border border-dashed border-line bg-canvas/35 p-5">
                <span className="grid size-12 place-items-center rounded-xl bg-line/60 text-muted">
                  <DocumentIcon name="academic" />
                </span>
                <StatusBadge tone="neutral">
                  Sin endpoint adicional
                </StatusBadge>
                <h3 className="mt-5 text-lg font-bold">
                  Otros documentos académicos
                </h3>
                <p className="mt-2 text-sm leading-6 text-muted">
                  La API actual no expone certificados, constancias,
                  expedientes ni documentos académicos adicionales.
                </p>
              </article>
            </div>
          </section>

          {financialAccess && (
            <section>
              <div className="mb-4">
                <p className="text-xs font-bold uppercase tracking-widest text-brand-soft">
                  Documentos financieros
                </p>
                <h2 className="mt-1 text-lg font-bold">
                  Estado de cuenta y solvencia
                </h2>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <DocumentCard
                  action="Descargar estado de cuenta"
                  available={Boolean(effectiveStudentId)}
                  category="Financiero"
                  description="Documento PDF con cargos, pagos y saldos autorizados para el alumno seleccionado."
                  icon="financial"
                  loading={downloading === "account"}
                  name="Estado de cuenta"
                  onAction={
                    effectiveStudentId
                      ? () => download("account")
                      : undefined
                  }
                  student={selectedStudent}
                />
                <article className="rounded-2xl border border-line bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <span className="grid size-12 place-items-center rounded-xl bg-brand-soft/10 text-brand-soft">
                      <DocumentIcon name="shield" />
                    </span>
                    <StatusBadge
                      tone={
                        solvencyLoading
                          ? "neutral"
                          : solvency?.solvente
                            ? "success"
                            : "warning"
                      }
                    >
                      {solvencyLoading
                        ? "Consultando"
                        : solvency
                          ? solvency.solvente
                            ? "Solvente"
                            : "No solvente"
                          : "No disponible"}
                    </StatusBadge>
                  </div>
                  <p className="mt-5 text-xs font-bold uppercase tracking-wide text-brand-soft">
                    Solvencia
                  </p>
                  <h3 className="mt-1 text-lg font-bold">
                    Estado de solvencia documental
                  </h3>
                  {solvency ? (
                    <div className="mt-4 space-y-3">
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(
                          solvency.saldoPendientePorMoneda,
                        ).map(([currency, amount]) => (
                          <StatusBadge key={currency} tone="warning">
                            {currency}: {money(currency, amount)}
                          </StatusBadge>
                        ))}
                        {!Object.keys(solvency.saldoPendientePorMoneda)
                          .length && (
                          <StatusBadge tone="success">
                            Sin saldos pendientes
                          </StatusBadge>
                        )}
                      </div>
                      <p className="text-sm leading-6 text-muted">
                        {solvency.cargosPendientes.length} cargos pendientes.
                        {solvency.conciliacionHistoricaRequerida
                          ? " La conciliación histórica requiere revisión."
                          : " Sin conciliación histórica pendiente."}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-4 text-sm leading-6 text-muted">
                      Selecciona un alumno para consultar el estado real.
                    </p>
                  )}
                </article>
              </div>

              <div className="mt-4 rounded-2xl border border-line bg-white p-5">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <h3 className="text-sm font-bold">
                      Requisitos configurados
                    </h3>
                    <p className="mt-1 text-xs text-muted">
                      Configuración obtenida de `/api/requisitos-solvencia`
                    </p>
                  </div>
                  <StatusBadge tone="info">
                    {requirements.length} requisitos
                  </StatusBadge>
                </div>
                {requirements.length ? (
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {requirements.map((requirement) => (
                      <div
                        className="flex items-center justify-between gap-3 rounded-xl bg-canvas/50 px-4 py-3"
                        key={requirement.id}
                      >
                        <span className="text-sm font-semibold">
                          {requirement.tipoDocumento}
                        </span>
                        <StatusBadge
                          tone={
                            requirement.requiereSolvencia
                              ? "warning"
                              : "neutral"
                          }
                        >
                          {requirement.requiereSolvencia
                            ? "Requiere solvencia"
                            : "No requerida"}
                        </StatusBadge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-muted">
                    No hay requisitos configurados.
                  </p>
                )}
              </div>
            </section>
          )}

          <section className="rounded-2xl border border-dashed border-line bg-canvas/35 p-5 sm:p-6">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-brand-soft">
                  Gestión documental futura
                </p>
                <h2 className="mt-1 text-lg font-bold">
                  Pendiente de desarrollo backend
                </h2>
              </div>
              <StatusBadge tone="warning">Sin endpoints</StatusBadge>
            </div>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
              Estas capacidades no ejecutan acciones ni muestran documentos
              ficticios. Requieren contrato, almacenamiento y autorización en
              el backend.
            </p>
            <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {futureCapabilities.map((capability) => (
                <div
                  className="rounded-xl border border-line bg-white/70 px-4 py-3 text-sm font-semibold text-muted"
                  key={capability}
                >
                  {capability}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </AdminPage>
  )
}
