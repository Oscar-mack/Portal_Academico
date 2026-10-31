import { FormEvent, useCallback, useEffect, useState } from "react"
import AdminPage from "../components/AdminPage"
import DataTable from "../components/DataTable"
import EmptyState from "../components/EmptyState"
import ErrorState from "../components/ErrorState"
import { FormField, SelectInput, TextInput } from "../components/FormField"
import LoadingState from "../components/LoadingState"
import Modal from "../components/Modal"
import StatusBadge from "../components/StatusBadge"
import { useAcademicPeriod } from "../context/AcademicPeriodContext"
import { catalogsService } from "../services/catalogsService"
import {
  academicAssignmentsService,
  type CourseOfferInput,
} from "../services/academicAssignmentsService"
import {
  catedraticosService,
  type Catedratico as TeacherRecord,
} from "../services/catedraticosService"
import type { Curso, OfertaCurso } from "../types/api"
import { FormActions, Notice } from "./admin/GradosCarrerasPage"

export default function CourseOfferingsPage() {
  const { periods, selectedPeriodId } = useAcademicPeriod()
  const [offers, setOffers] = useState<OfertaCurso[]>([])
  const [courses, setCourses] = useState<Curso[]>([])
  const [teachers, setTeachers] = useState<TeacherRecord[]>([])
  const [editor, setEditor] = useState<OfertaCurso | "create" | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const [offerRows, courseRows, teacherRows] = await Promise.all([
        academicAssignmentsService.listCourseOffers(selectedPeriodId ?? undefined),
        catalogsService.listCourses(true),
        catedraticosService.list(),
      ])
      setOffers(offerRows)
      setCourses(courseRows)
      setTeachers(teacherRows)
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible consultar las secciones.",
      )
    } finally {
      setLoading(false)
    }
  }, [selectedPeriodId])

  useEffect(() => {
    load()
  }, [load])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const record = editor === "create" ? null : editor
    const dates = {
      fechaInscripcionInicio: String(form.get("fechaInscripcionInicio")),
      fechaInscripcionFin: String(form.get("fechaInscripcionFin")),
    }
    setSaving(true)
    setError("")
    try {
      if (record) {
        await academicAssignmentsService.updateCourseOffer(record.id, {
          cupoMaximo: Number(form.get("cupoMaximo")),
          ...dates,
        })
        setNotice("La sección se actualizó correctamente.")
      } else {
        const input: CourseOfferInput = {
          cursoId: Number(form.get("cursoId")),
          catedraticoId: Number(form.get("catedraticoId")),
          periodoAcademicoId: Number(form.get("periodoAcademicoId")),
          codigoSeccion: String(form.get("codigoSeccion")).trim(),
          cupoMaximo: Number(form.get("cupoMaximo")),
          ...dates,
        }
        await academicAssignmentsService.createCourseOffer(input)
        setNotice("La sección se creó. Configura sus bloques en Horarios docentes antes de abrir la inscripción.")
      }
      setEditor(null)
      await load()
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible guardar la sección.",
      )
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(offer: OfertaCurso) {
    setError("")
    try {
      await academicAssignmentsService.updateCourseOffer(offer.id, {
        activo: !offer.activo,
      })
      setNotice(offer.activo ? "La sección se desactivó." : "La sección se activó.")
      await load()
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible cambiar el estado de la sección.",
      )
    }
  }

  const record = editor === "create" ? null : editor

  return (
    <>
      <AdminPage
        action={
          <button
            className="h-11 rounded-xl bg-brand px-5 text-sm font-bold text-white hover:bg-brand-dark"
            onClick={() => {
              setError("")
              setEditor("create")
            }}
            type="button"
          >
            + Crear sección
          </button>
        }
        count={loading ? "Consultando secciones..." : `${offers.length} secciones`}
        description="Define curso, docente, período, cupo y ventana de inscripción. Los horarios de cada sección se configuran en Horarios docentes."
        title="Oferta de cursos"
      >
        <div className="border-b border-line bg-brand-soft/5 px-5 py-3 text-xs leading-5 text-muted sm:px-6">
          La autoinscripción solo está disponible durante las fechas configuradas,
          en períodos abiertos y para el programa del alumno. Los cupos se
          reservan de forma transaccional.
        </div>
        {notice && <Notice message={notice} onClose={() => setNotice("")} />}
        {error && (
          <div className="mx-5 mt-5 sm:mx-6">
            <ErrorState message={error} onRetry={load} />
          </div>
        )}
        {loading ? (
          <LoadingState rows={5} />
        ) : offers.length ? (
          <DataTable minWidth="min-w-[72rem]">
            <thead>
              <tr className="border-b border-line bg-canvas/45 text-[0.68rem] font-bold uppercase tracking-wider text-muted">
                <th className="px-6 py-3.5">Curso / sección</th>
                <th className="px-4 py-3.5">Docente y período</th>
                <th className="px-4 py-3.5">Cupo</th>
                <th className="px-4 py-3.5">Ventana</th>
                <th className="px-4 py-3.5">Horario</th>
                <th className="px-6 py-3.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {offers.map((offer) => (
                <tr className="hover:bg-canvas/40" key={offer.id}>
                  <td className="px-6 py-4">
                    <p className="text-sm font-bold">
                      {offer.curso?.codigo} · {offer.curso?.nombre}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      Sección {offer.codigoSeccion} ·{" "}
                      {offer.curso?.gradoCarrera?.nombre ?? "Programa"}
                    </p>
                  </td>
                  <td className="px-4 py-4 text-sm">
                    <p>{offer.catedratico?.nombre} {offer.catedratico?.apellido}</p>
                    <p className="mt-1 text-xs text-muted">
                      {offer.periodoAcademico?.nombre}
                    </p>
                  </td>
                  <td className="px-4 py-4 text-sm">
                    {offer.inscritos ?? 0} / {offer.cupoMaximo}
                    <p className="mt-1 text-xs text-muted">
                      {offer.seatsAvailable ?? 0} disponibles
                    </p>
                  </td>
                  <td className="px-4 py-4 text-xs text-muted">
                    {offer.fechaInscripcionInicio} – {offer.fechaInscripcionFin}
                  </td>
                  <td className="px-4 py-4">
                    {offer.horarios?.length ? (
                      <StatusBadge tone="success">{offer.horarios.length} bloques</StatusBadge>
                    ) : (
                      <StatusBadge tone="warning">Sin horario</StatusBadge>
                    )}
                    {offer.registrationReason && (
                      <p className="mt-1 max-w-48 text-xs text-muted">
                        {offer.registrationReason}
                      </p>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex justify-end gap-2">
                      <button
                        className="rounded-lg border border-brand-soft/25 px-3 py-2 text-xs font-bold text-brand-soft"
                        onClick={() => {
                          setError("")
                          setEditor(offer)
                        }}
                        type="button"
                      >
                        Editar
                      </button>
                      <button
                        className="rounded-lg border border-line px-3 py-2 text-xs font-bold text-muted"
                        onClick={() => toggleActive(offer)}
                        type="button"
                      >
                        {offer.activo ? "Desactivar" : "Activar"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : (
          <EmptyState
            description="Crea una sección por curso, período y docente; después agrega sus bloques de horario."
            title="Sin secciones configuradas"
          />
        )}
      </AdminPage>

      <Modal
        description={
          record
            ? "El curso, docente, período y código de sección no se pueden cambiar una vez creada."
            : "Las fechas deben estar dentro del período académico. El cupo debe ser positivo."
        }
        onClose={() => setEditor(null)}
        open={Boolean(editor)}
        title={record ? "Editar sección" : "Crear sección de curso"}
      >
        <form onSubmit={submit}>
          <div className="grid gap-5 px-6 py-6 sm:grid-cols-2">
            {!record && (
              <>
                <FormField label="Curso">
                  <SelectInput name="cursoId" required>
                    <option value="">Selecciona un curso</option>
                    {courses.filter((course) => course.activo).map((course) => (
                      <option key={course.id} value={course.id}>
                        {course.codigo} · {course.nombre}
                      </option>
                    ))}
                  </SelectInput>
                </FormField>
                <FormField label="Catedrático">
                  <SelectInput name="catedraticoId" required>
                    <option value="">Selecciona un catedrático</option>
                    {teachers.filter((teacher) => teacher.activo).map((teacher) => (
                      <option key={teacher.id} value={teacher.id}>
                        {teacher.nombre} {teacher.apellido}
                      </option>
                    ))}
                  </SelectInput>
                </FormField>
                <FormField label="Período académico">
                  <SelectInput
                    defaultValue={selectedPeriodId ?? ""}
                    name="periodoAcademicoId"
                    required
                  >
                    <option value="">Selecciona un período</option>
                    {periods.filter((period) => period.estado === "abierto").map((period) => (
                      <option key={period.id} value={period.id}>
                        {period.nombre} · {period.fechaInicio}–{period.fechaFin}
                      </option>
                    ))}
                  </SelectInput>
                </FormField>
                <FormField label="Código de sección">
                  <TextInput maxLength={30} name="codigoSeccion" required />
                </FormField>
              </>
            )}
            <FormField label="Cupo máximo">
              <TextInput
                defaultValue={record?.cupoMaximo}
                min="1"
                name="cupoMaximo"
                required
                step="1"
                type="number"
              />
            </FormField>
            <FormField label="Inscripción desde">
              <TextInput
                defaultValue={record?.fechaInscripcionInicio}
                name="fechaInscripcionInicio"
                required
                type="date"
              />
            </FormField>
            <FormField label="Inscripción hasta">
              <TextInput
                defaultValue={record?.fechaInscripcionFin}
                name="fechaInscripcionFin"
                required
                type="date"
              />
            </FormField>
          </div>
          <FormActions
            error={error}
            label={record ? "Guardar sección" : "Crear sección"}
            onCancel={() => setEditor(null)}
            saving={saving}
          />
        </form>
      </Modal>
    </>
  )
}
