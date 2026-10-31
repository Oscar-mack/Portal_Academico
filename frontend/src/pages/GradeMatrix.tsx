import { FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import DataTable from "../components/DataTable"
import EmptyState from "../components/EmptyState"
import ErrorState from "../components/ErrorState"
import { FormField, TextAreaInput, TextInput } from "../components/FormField"
import LoadingState from "../components/LoadingState"
import Modal from "../components/Modal"
import StatusBadge from "../components/StatusBadge"
import { academicAssignmentsService } from "../services/academicAssignmentsService"
import { evaluationsService } from "../services/evaluationsService"
import { notesService } from "../services/notesService"
import type {
  AsignacionCurso,
  CalificacionEvaluacion,
  Curso,
  Evaluacion,
  Nota,
} from "../types/api"
import { FormActions, Notice } from "./admin/GradosCarrerasPage"

interface PendingChange {
  studentId: number
  value: number
  note: Nota
}

function fullName(assignment: AsignacionCurso) {
  return assignment.alumno
    ? `${assignment.alumno.nombre} ${assignment.alumno.apellido}`
    : `Alumno ID ${assignment.alumnoId}`
}

export default function GradeMatrix({
  evaluation,
  course,
  onBack,
}: {
  evaluation: Evaluacion
  course?: Curso
  onBack: () => void
}) {
  const maximum = Number(evaluation.puntajeMaximo)
  const [assignments, setAssignments] = useState<AsignacionCurso[]>([])
  const [grades, setGrades] = useState<CalificacionEvaluacion[]>([])
  const [notes, setNotes] = useState<Nota[]>([])
  const [values, setValues] = useState<Record<number, string>>({})
  const [savingId, setSavingId] = useState<number | null>(null)
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const [assignmentRows, gradeRows, noteRows] = await Promise.all([
        academicAssignmentsService.listAssignments({
          cursoId: evaluation.cursoId,
          periodoAcademicoId: evaluation.periodoAcademicoId,
        }),
        evaluationsService.listGrades(evaluation.id),
        notesService.list({
          cursoId: evaluation.cursoId,
          periodoAcademicoId: evaluation.periodoAcademicoId,
        }),
      ])
      setAssignments(assignmentRows)
      setGrades(gradeRows)
      setNotes(noteRows)
      setValues(
        Object.fromEntries(
          assignmentRows.map((assignment) => {
            const grade = gradeRows.find(
              (item) => item.alumnoId === assignment.alumnoId,
            )
            return [assignment.alumnoId, grade ? String(grade.valor) : ""]
          }),
        ),
      )
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible cargar la matriz de calificaciones.",
      )
    } finally {
      setLoading(false)
    }
  }, [evaluation])

  useEffect(() => {
    load()
  }, [load])

  const registered = useMemo(
    () => assignments.filter((item) => values[item.alumnoId] !== "").length,
    [assignments, values],
  )

  async function saveGrade(
    studentId: number,
    value: number,
    motivo?: string,
  ) {
    setSavingId(studentId)
    setError("")
    try {
      const response = await evaluationsService.saveGrade(evaluation.id, {
        alumnoId: studentId,
        valor: value,
        ...(motivo ? { motivo } : {}),
      })
      setNotice(
        response.consolidada
          ? response.notaFinal?.publicadaEn
            ? "La calificación y la nota final se actualizaron."
            : "La calificación se guardó. La nota final quedó pendiente de publicación."
          : "La calificación se guardó. La nota final aún no puede consolidarse.",
      )
      setPendingChange(null)
      await load()
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible guardar la calificación.",
      )
    } finally {
      setSavingId(null)
    }
  }

  function requestSave(studentId: number) {
    const rawValue = values[studentId]
    const value = Number(rawValue)
    if (
      rawValue === "" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > maximum
    ) {
      setError(`La calificación debe estar entre 0 y ${maximum}.`)
      return
    }
    const previous = grades.find((grade) => grade.alumnoId === studentId)
    const finalNote = notes.find((note) => note.alumnoId === studentId)
    if (
      previous &&
      Number(previous.valor) !== value &&
      finalNote?.publicadaEn
    ) {
      setPendingChange({ studentId, value, note: finalNote })
      return
    }
    saveGrade(studentId, value)
  }

  function submitReason(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!pendingChange) return
    const form = new FormData(event.currentTarget)
    const motivo = String(form.get("motivo") ?? "").trim()
    if (motivo.length < 10) {
      setError("El motivo debe contener al menos 10 caracteres.")
      return
    }
    saveGrade(pendingChange.studentId, pendingChange.value, motivo)
  }

  return (
    <>
      <section className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="flex flex-col justify-between gap-4 border-b border-line p-5 sm:flex-row sm:items-center sm:p-6">
          <div>
            <button
              className="mb-3 text-xs font-bold text-brand-soft hover:text-brand"
              onClick={onBack}
              type="button"
            >
              ← Volver a evaluaciones
            </button>
            <h2 className="text-lg font-bold">{evaluation.nombre}</h2>
            <p className="mt-1 text-sm text-muted">
              {course?.nombre ?? `Curso ID ${evaluation.cursoId}`} · máximo{" "}
              {maximum} puntos
            </p>
          </div>
          <div className="flex gap-2">
            <StatusBadge
              tone={
                registered === assignments.length && assignments.length
                  ? "success"
                  : "warning"
              }
            >
              {registered}/{assignments.length} registradas
            </StatusBadge>
          </div>
        </div>
        <div className="border-b border-line bg-brand-soft/5 px-5 py-3 text-xs leading-5 text-muted sm:px-6">
          El servidor consolida la nota final únicamente cuando los máximos de
          las evaluaciones suman 100 y el alumno tiene todos los puntajes.
        </div>
        {notice && <Notice message={notice} onClose={() => setNotice("")} />}
        {error && !pendingChange && (
          <div className="mx-5 mt-5 sm:mx-6">
            <ErrorState message={error} onRetry={load} />
          </div>
        )}
        {loading ? (
          <LoadingState rows={5} />
        ) : assignments.length ? (
          <DataTable minWidth="min-w-[56rem]">
            <thead>
              <tr className="border-b border-line bg-canvas/45 text-[0.68rem] font-bold uppercase tracking-wider text-muted">
                <th className="px-6 py-3.5">ID</th>
                <th className="px-4 py-3.5">Estudiante</th>
                <th className="px-4 py-3.5">Puntaje máximo</th>
                <th className="px-4 py-3.5">Calificación</th>
                <th className="px-4 py-3.5">Estado</th>
                <th className="px-6 py-3.5 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {assignments.map((assignment) => {
                const grade = grades.find(
                  (item) => item.alumnoId === assignment.alumnoId,
                )
                const value = values[assignment.alumnoId] ?? ""
                const invalid =
                  value !== "" &&
                  (!Number.isFinite(Number(value)) ||
                    Number(value) < 0 ||
                    Number(value) > maximum)
                return (
                  <tr className="hover:bg-canvas/40" key={assignment.id}>
                    <td className="px-6 py-4 font-mono text-xs text-muted">
                      {assignment.alumnoId}
                    </td>
                    <td className="px-4 py-4">
                      <p className="text-sm font-bold">
                        {fullName(assignment)}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {assignment.alumno?.email}
                      </p>
                    </td>
                    <td className="px-4 py-4 text-sm text-muted">
                      {maximum}
                    </td>
                    <td className="w-40 px-4 py-4">
                      <TextInput
                        aria-label={`Calificación de ${fullName(assignment)}`}
                        className={invalid ? "border-red-300" : ""}
                        max={maximum}
                        min="0"
                        onChange={(event) =>
                          setValues((current) => ({
                            ...current,
                            [assignment.alumnoId]: event.target.value,
                          }))
                        }
                        step="0.01"
                        type="number"
                        value={value}
                      />
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge tone={grade ? "success" : "warning"}>
                        {grade ? "Registrada" : "Pendiente"}
                      </StatusBadge>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        className="rounded-lg bg-brand px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                        disabled={
                          savingId === assignment.alumnoId ||
                          value === "" ||
                          invalid
                        }
                        onClick={() => requestSave(assignment.alumnoId)}
                        type="button"
                      >
                        {savingId === assignment.alumnoId
                          ? "Guardando..."
                          : grade
                            ? "Actualizar"
                            : "Registrar"}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </DataTable>
        ) : (
          <EmptyState
            description="No hay alumnos inscritos en este curso y período."
            title="Sin estudiantes"
          />
        )}
      </section>

      <Modal
        description="Cambiar una calificación que alimenta una nota publicada dejará la nota final pendiente de publicación."
        onClose={() => {
          setPendingChange(null)
          setError("")
        }}
        open={Boolean(pendingChange)}
        title="Modificar calificación publicada"
      >
        {pendingChange && (
          <form onSubmit={submitReason}>
            <div className="space-y-5 px-6 py-6">
              <div className="grid gap-3 rounded-xl bg-canvas/60 p-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-bold uppercase text-muted">
                    Nota final actual
                  </p>
                  <p className="mt-1 text-lg font-bold">
                    {pendingChange.note.valor}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase text-muted">
                    Nueva calificación
                  </p>
                  <p className="mt-1 text-lg font-bold">
                    {pendingChange.value}/{maximum}
                  </p>
                </div>
              </div>
              <FormField
                hint="Mínimo 10 caracteres. El motivo quedará registrado en la auditoría."
                label="Motivo de modificación"
              >
                <TextAreaInput
                  minLength={10}
                  name="motivo"
                  placeholder="Explica claramente por qué se modifica la calificación..."
                  required
                />
              </FormField>
            </div>
            <FormActions
              error={error}
              label="Confirmar modificación"
              onCancel={() => {
                setPendingChange(null)
                setError("")
              }}
              saving={savingId !== null}
            />
          </form>
        )}
      </Modal>
    </>
  )
}
