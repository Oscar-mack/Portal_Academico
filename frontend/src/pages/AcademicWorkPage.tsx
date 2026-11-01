import { FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import AdminPage from "../components/AdminPage"
import EmptyState from "../components/EmptyState"
import ErrorState from "../components/ErrorState"
import LoadingState from "../components/LoadingState"
import StatusBadge from "../components/StatusBadge"
import { useAcademicPeriod } from "../context/AcademicPeriodContext"
import type { AuthUser } from "../lib/api"
import { academicAssignmentsService } from "../services/academicAssignmentsService"
import {
  academicWorkService,
  type AcademicTask,
  type CourseMaterial,
  type TaskSubmission,
} from "../services/academicWorkService"
import type { HorarioCatedratico } from "../types/api"

const ACCEPTED_FILES =
  ".pdf,.docx,.xlsx,.pptx,.txt,.jpg,.jpeg,.png,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,image/jpeg,image/png"
const MAX_FILE_BYTES = 20 * 1024 * 1024

function localDateTime(value?: string) {
  if (!value) return ""
  const date = new Date(value)
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

function statusTone(status?: string): "success" | "warning" | "neutral" {
  return status === "entregada" ? "success" : status === "vencida" ? "warning" : "neutral"
}

export default function AcademicWorkPage({ user }: { user: AuthUser }) {
  const { periods, selectedPeriodId } = useAcademicPeriod()
  const isTeacher = user.rol === "catedratico"
  const isStudent = user.rol === "alumno"
  const canManage = isTeacher
  const [tasks, setTasks] = useState<AcademicTask[]>([])
  const [materials, setMaterials] = useState<CourseMaterial[]>([])
  const [schedules, setSchedules] = useState<HorarioCatedratico[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [coursesError, setCoursesError] = useState("")
  const [notice, setNotice] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [editing, setEditing] = useState<AcademicTask | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const [submissions, setSubmissions] = useState<TaskSubmission[]>([])
  const [busyAction, setBusyAction] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    setCoursesError("")
    const filters = { periodoAcademicoId: selectedPeriodId ?? undefined }
    // Cada consulta es independiente: un error en una no debe vaciar las demás.
    const [taskResult, materialResult, scheduleResult] = await Promise.allSettled([
      academicWorkService.listTasks({
        ...filters,
        estado: isStudent ? statusFilter || undefined : undefined,
      }),
      academicWorkService.listMaterials(filters),
      canManage ? academicAssignmentsService.listSchedules(filters) : Promise.resolve([]),
    ])
    const reason = (result: PromiseRejectedResult, fallback: string) =>
      result.reason instanceof Error ? result.reason.message : fallback
    const problems: string[] = []

    if (taskResult.status === "fulfilled") setTasks(taskResult.value)
    else {
      setTasks([])
      problems.push(`Tareas: ${reason(taskResult, "No fue posible consultar las tareas.")}`)
    }
    if (materialResult.status === "fulfilled") setMaterials(materialResult.value)
    else {
      setMaterials([])
      problems.push(`Materiales: ${reason(materialResult, "No fue posible consultar los materiales.")}`)
    }
    if (scheduleResult.status === "fulfilled") setSchedules(scheduleResult.value)
    else {
      setSchedules([])
      setCoursesError(
        `Cursos asignados: ${reason(scheduleResult, "No fue posible consultar tus cursos asignados.")}`,
      )
    }
    setError(problems.join(" "))
    setLoading(false)
  }, [canManage, isStudent, selectedPeriodId, statusFilter])

  useEffect(() => {
    load()
  }, [load])

  // Un curso puede tener varios bloques de horario; se ofrece una opción por curso y período.
  const courseOptions = useMemo(() => {
    const options = new Map<string, { value: string; label: string }>()
    for (const row of schedules) {
      if (!row.periodoAcademicoId || !row.curso) continue
      if (row.catedraticoId !== Number(user.catedraticoId ?? row.catedraticoId)) continue
      const value = `${row.cursoId}:${row.periodoAcademicoId}`
      const periodName =
        periods.find((period) => period.id === row.periodoAcademicoId)?.nombre ??
        `Período ${row.periodoAcademicoId}`
      options.set(value, {
        value,
        label: `${row.curso.codigo} · ${row.curso.nombre} · ${periodName}`,
      })
    }
    return [...options.values()]
  }, [periods, schedules, user.catedraticoId])

  async function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const coursePeriod = String(form.get("cursoPeriodo") ?? "").split(":")
    const title = String(form.get("titulo") ?? "").trim()
    const description = String(form.get("descripcion") ?? "").trim()
    const instructions = String(form.get("instrucciones") ?? "").trim()
    const fechaPublicacion = new Date(String(form.get("fechaPublicacion"))).toISOString()
    const fechaLimite = new Date(String(form.get("fechaLimite"))).toISOString()
    if (!editing && (!coursePeriod[0] || !coursePeriod[1])) {
      setError("Selecciona un curso y período asignados a tu perfil.")
      return
    }
    setSaving(true)
    setError("")
    try {
      const input = {
        titulo: title,
        descripcion: description,
        instrucciones: instructions,
        fechaPublicacion,
        fechaLimite,
      }
      if (editing) {
        await academicWorkService.updateTask(editing.id, input)
        setNotice("La tarea se actualizó correctamente.")
      } else {
        await academicWorkService.createTask({
          ...input,
          cursoId: Number(coursePeriod[0]),
          periodoAcademicoId: Number(coursePeriod[1]),
        })
        setNotice("La tarea se creó correctamente.")
      }
      setEditing(null)
      await load()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible guardar la tarea.")
    } finally {
      setSaving(false)
    }
  }

  async function uploadFile(
    event: FormEvent<HTMLFormElement>,
    action: (form: FormData) => Promise<unknown>,
  ) {
    event.preventDefault()
    const targetForm = event.currentTarget
    const form = new FormData(targetForm)
    const file = form.get("file")
    if (!(file instanceof File) || !file.size) {
      setError("Selecciona un archivo.")
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("El archivo excede el máximo permitido de 20 MiB.")
      return
    }
    setSaving(true)
    setError("")
    try {
      await action(form)
      setNotice("El archivo se cargó correctamente.")
      targetForm.reset()
      await load()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible cargar el archivo.")
    } finally {
      setSaving(false)
    }
  }

  async function showSubmissions(taskId: number) {
    setSelectedTaskId(taskId)
    setError("")
    try {
      setSubmissions(await academicWorkService.listSubmissions(taskId))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible consultar las entregas.")
    }
  }

  async function downloadFile(fileId: number) {
    setError("")
    try {
      await academicWorkService.downloadFile(fileId)
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible descargar el archivo.",
      )
    }
  }

  async function deactivateTask(task: AcademicTask) {
    setBusyAction(task.id)
    setError("")
    try {
      await academicWorkService.deactivateTask(task.id)
      setNotice("La tarea se desactivó correctamente.")
      await load()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible desactivar la tarea.")
    } finally {
      setBusyAction(null)
    }
  }

  async function deactivateMaterial(material: CourseMaterial) {
    setBusyAction(material.id)
    setError("")
    try {
      await academicWorkService.deactivateMaterial(material.id)
      setNotice("El material dejó de estar disponible.")
      await load()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible desactivar el material.")
    } finally {
      setBusyAction(null)
    }
  }

  const title = isTeacher ? "Tareas y materiales" : isStudent ? "Tareas y materiales" : "Tareas académicas"

  return (
    <AdminPage
      count={`${tasks.length} tareas · ${materials.length} materiales`}
      description="Actividades y documentos reales asociados a tus cursos y períodos académicos."
      title={title}
    >
      <div className="space-y-6 p-5 sm:p-6">
        {notice && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">
            {notice}
            <button className="ml-3 font-bold underline" onClick={() => setNotice("")} type="button">Cerrar</button>
          </div>
        )}
        {error && <ErrorState message={error} onRetry={load} />}

        {isStudent && (
          <label className="block max-w-xs text-sm font-semibold">
            Estado de entrega
            <select
              className="mt-2 h-11 w-full rounded-xl border border-line bg-white px-3"
              onChange={(event) => setStatusFilter(event.target.value)}
              value={statusFilter}
            >
              <option value="">Todos los estados</option>
              <option value="pendiente">Pendientes</option>
              <option value="entregada">Entregadas</option>
              <option value="vencida">Vencidas</option>
            </select>
          </label>
        )}

        {canManage && (
          <section className="rounded-2xl border border-line bg-white p-5">
            <h2 className="text-lg font-bold">{editing ? "Editar tarea" : "Crear tarea"}</h2>
            <p className="mt-1 text-sm text-muted">Solo puedes crear tareas en cursos y períodos asignados a tu horario.</p>
            <form className="mt-4 grid gap-4 md:grid-cols-2" key={editing?.id ?? "new"} onSubmit={submitTask}>
              {!editing ? (
                <label className="text-sm font-semibold md:col-span-2">
                  Curso y período
                  <select className="mt-2 h-11 w-full rounded-xl border border-line bg-white px-3" name="cursoPeriodo" required>
                    <option value="">Selecciona un curso</option>
                    {courseOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {coursesError ? (
                    <span className="mt-2 block text-xs font-normal text-red-700">{coursesError}</span>
                  ) : !loading && !courseOptions.length ? (
                    <span className="mt-2 block text-xs font-normal text-amber-800">
                      No tienes cursos asignados con horario en el período seleccionado. Solicita a administración
                      que registre tu horario vinculado a un período académico.
                    </span>
                  ) : null}
                </label>
              ) : (
                <p className="rounded-xl bg-canvas p-3 text-sm font-semibold md:col-span-2">
                  {editing.curso?.codigo} · {editing.curso?.nombre} · {editing.periodoAcademico?.nombre}
                </p>
              )}
              <label className="text-sm font-semibold">
                Título
                <input className="mt-2 h-11 w-full rounded-xl border border-line px-3" defaultValue={editing?.titulo} maxLength={150} name="titulo" required />
              </label>
              <label className="text-sm font-semibold">
                Fecha de publicación
                <input className="mt-2 h-11 w-full rounded-xl border border-line px-3" defaultValue={localDateTime(editing?.fechaPublicacion)} name="fechaPublicacion" required type="datetime-local" />
              </label>
              <label className="text-sm font-semibold">
                Fecha límite
                <input className="mt-2 h-11 w-full rounded-xl border border-line px-3" defaultValue={localDateTime(editing?.fechaLimite)} name="fechaLimite" required type="datetime-local" />
              </label>
              <label className="text-sm font-semibold md:col-span-2">
                Descripción
                <textarea className="mt-2 w-full rounded-xl border border-line p-3" defaultValue={editing?.descripcion} maxLength={5000} name="descripcion" required rows={2} />
              </label>
              <label className="text-sm font-semibold md:col-span-2">
                Instrucciones
                <textarea className="mt-2 w-full rounded-xl border border-line p-3" defaultValue={editing?.instrucciones} maxLength={10000} name="instrucciones" required rows={3} />
              </label>
              <div className="flex flex-wrap gap-2 md:col-span-2">
                <button className="h-10 rounded-xl bg-brand px-4 text-sm font-bold text-white disabled:opacity-50" disabled={saving} type="submit">
                  {saving ? "Guardando..." : editing ? "Guardar cambios" : "Crear tarea"}
                </button>
                {editing && <button className="h-10 rounded-xl border border-line px-4 text-sm font-semibold" onClick={() => setEditing(null)} type="button">Cancelar edición</button>}
              </div>
            </form>
          </section>
        )}

        {loading ? <LoadingState rows={3} /> : tasks.length ? (
          <section className="space-y-3">
            <h2 className="text-lg font-bold">Tareas</h2>
            {tasks.map((task) => (
              <article className="rounded-2xl border border-line bg-white p-5" key={task.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase text-brand-soft">{task.curso?.codigo} · {task.curso?.nombre} · {task.periodoAcademico?.nombre}</p>
                    <h3 className="mt-1 text-lg font-bold">{task.titulo}</h3>
                  </div>
                  {isStudent && <StatusBadge tone={statusTone(task.estadoEntrega)}>{task.estadoEntrega}</StatusBadge>}
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm text-muted">{task.descripcion}</p>
                <p className="mt-2 whitespace-pre-wrap text-sm">{task.instrucciones}</p>
                <p className="mt-3 text-xs text-muted">
                  Publicación: {new Date(task.fechaPublicacion).toLocaleString()} · Límite: {new Date(task.fechaLimite).toLocaleString()}
                </p>
                {!!task.adjuntos?.length && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {task.adjuntos.map((file) => (
                      <button className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-brand-soft" key={file.id} onClick={() => downloadFile(file.id)} type="button">
                        Descargar {file.nombreOriginal}
                      </button>
                    ))}
                  </div>
                )}
                {isStudent && task.miEntrega && (
                  <p className="mt-3 text-sm text-emerald-700">Entregada el {new Date(task.miEntrega.entregadaEn).toLocaleString()} · {task.miEntrega.nombreOriginal}</p>
                )}
                {isStudent && task.estadoEntrega !== "entregada" && task.estadoEntrega !== "vencida" && (
                  <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(event) => uploadFile(event, (data) => academicWorkService.submitTask(task.id, data))}>
                    <label className="text-sm font-semibold">
                      Entregar archivo (máximo 20 MiB)
                      <input className="mt-2 block max-w-full text-sm" accept={ACCEPTED_FILES} name="file" required type="file" />
                    </label>
                    <button className="h-10 rounded-xl bg-brand px-4 text-sm font-bold text-white disabled:opacity-50" disabled={saving} type="submit">{saving ? "Subiendo..." : "Enviar entrega"}</button>
                  </form>
                )}
                {canManage && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button className="rounded-lg border border-line px-3 py-2 text-xs font-bold" onClick={() => setEditing(task)} type="button">Editar</button>
                    <button className="rounded-lg border border-line px-3 py-2 text-xs font-bold" disabled={busyAction === task.id} onClick={() => deactivateTask(task)} type="button">Desactivar</button>
                    <button className="rounded-lg border border-line px-3 py-2 text-xs font-bold" onClick={() => showSubmissions(task.id)} type="button">Consultar entregas</button>
                    <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => uploadFile(event, (data) => academicWorkService.attachTaskFile(task.id, data))}>
                      <input accept={ACCEPTED_FILES} aria-label={`Adjuntar archivo a ${task.titulo}`} name="file" required type="file" />
                      <button className="rounded-lg border border-brand-soft/30 px-3 py-2 text-xs font-bold text-brand-soft" disabled={saving} type="submit">Adjuntar archivo</button>
                    </form>
                  </div>
                )}
                {selectedTaskId === task.id && canManage && (
                  <div className="mt-4 rounded-xl bg-canvas/60 p-4">
                    <h4 className="font-bold">Estado de alumnos inscritos</h4>
                    {submissions.length ? (
                      <ul className="mt-3 divide-y divide-line">
                        {submissions.map((submission) => (
                          <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" key={submission.alumno.id}>
                            <span>{submission.alumno.nombre} {submission.alumno.apellido}</span>
                            <span className="flex items-center gap-2">
                              <StatusBadge tone={statusTone(submission.estado)}>{submission.estado}</StatusBadge>
                              {submission.entrega && <button className="font-semibold text-brand-soft underline" onClick={() => downloadFile(submission.entrega!.archivo.id)} type="button">Descargar entrega</button>}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="mt-2 text-sm text-muted">No hay alumnos inscritos para este curso y período.</p>}
                  </div>
                )}
              </article>
            ))}
          </section>
        ) : <EmptyState description="No hay tareas disponibles para los filtros y períodos seleccionados." title="Sin tareas" />}

        {canManage && (
          <section className="rounded-2xl border border-line bg-white p-5">
            <h2 className="text-lg font-bold">Compartir material del curso</h2>
            <p className="mt-1 text-sm text-muted">Archivos privados asociados a tu curso y período. Máximo 20 MiB.</p>
            <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={(event) => {
              const form = event.currentTarget
              const pair = String(new FormData(form).get("cursoPeriodo") ?? "").split(":")
              if (!pair[0] || !pair[1]) {
                event.preventDefault()
                setError("Selecciona un curso y período asignados.")
                return
              }
              void uploadFile(event, (data) => academicWorkService.createMaterial(Number(pair[0]), Number(pair[1]), data))
            }}>
              <label className="text-sm font-semibold md:col-span-2">
                Curso y período
                <select className="mt-2 h-11 w-full rounded-xl border border-line bg-white px-3" name="cursoPeriodo" required>
                  <option value="">Selecciona un curso</option>
                  {courseOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="text-sm font-semibold">
                Título del material
                <input className="mt-2 h-11 w-full rounded-xl border border-line px-3" maxLength={150} name="titulo" required />
              </label>
              <label className="text-sm font-semibold">
                Descripción (opcional)
                <input className="mt-2 h-11 w-full rounded-xl border border-line px-3" maxLength={2000} name="descripcion" />
              </label>
              <label className="text-sm font-semibold md:col-span-2">
                Archivo
                <input className="mt-2 block text-sm" accept={ACCEPTED_FILES} name="file" required type="file" />
              </label>
              <button className="h-10 w-fit rounded-xl bg-brand px-4 text-sm font-bold text-white disabled:opacity-50" disabled={saving} type="submit">{saving ? "Subiendo..." : "Publicar material"}</button>
            </form>
          </section>
        )}

        <section>
          <h2 className="mb-3 text-lg font-bold">Materiales compartidos</h2>
          {materials.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {materials.map((material) => (
                <article className="rounded-2xl border border-line bg-white p-4" key={material.id}>
                  <p className="text-xs font-bold uppercase text-brand-soft">{material.curso?.codigo} · {material.curso?.nombre} · {material.periodoAcademico?.nombre}</p>
                  <h3 className="mt-1 font-bold">{material.titulo}</h3>
                  {material.descripcion && <p className="mt-1 text-sm text-muted">{material.descripcion}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button className="rounded-lg border border-line px-3 py-2 text-xs font-bold text-brand-soft" onClick={() => downloadFile(material.archivo.id)} type="button">Descargar {material.archivo.nombreOriginal}</button>
                    {canManage && <button className="rounded-lg border border-line px-3 py-2 text-xs font-bold" disabled={busyAction === material.id} onClick={() => deactivateMaterial(material)} type="button">Desactivar</button>}
                  </div>
                </article>
              ))}
            </div>
          ) : !loading && <EmptyState description="No hay materiales activos disponibles en este período." title="Sin materiales" />}
        </section>
      </div>
    </AdminPage>
  )
}
