const db = require("../models");
const ROLES = require("../config/roles.js");
const storage = require("../services/r2Storage.js");

async function teacherCanAccess(teacherUserId, cursoId, periodoAcademicoId) {
  const teacher = await db.catedraticos.findOne({
    where: { usuarioId: teacherUserId, activo: true }
  });
  if (!teacher) return false;
  return Boolean(await db.horariosCatedratico.findOne({
    where: { catedraticoId: teacher.id, cursoId, periodoAcademicoId }
  }));
}

async function teacherCanAccessTask(teacherUserId, task) {
  const teacher = await db.catedraticos.findOne({
    where: { usuarioId: teacherUserId, activo: true }
  });
  return Boolean(teacher && teacher.id === task.catedraticoId &&
    await db.horariosCatedratico.findOne({
      where: {
        catedraticoId: teacher.id,
        cursoId: task.cursoId,
        periodoAcademicoId: task.periodoAcademicoId
      }
    }));
}

async function studentCanAccess(userId, cursoId, periodoAcademicoId) {
  const student = await db.alumnos.findOne({
    where: { usuarioId: userId, activo: true }
  });
  if (!student) return false;
  return Boolean(await db.asignacionesCurso.findOne({
    where: { alumnoId: student.id, cursoId, periodoAcademicoId }
  }));
}

exports.download = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).send({ message: "id debe ser un identificador válido." });
    const file = await db.archivosAcademicos.findByPk(id);
    if (!file) return res.status(404).send({ message: "Archivo no encontrado." });
    if (req.userRole !== ROLES.ADMIN) {
      if (req.userRole !== ROLES.ALUMNO && req.userRole !== ROLES.CATEDRATICO) {
        return res.status(403).send({ message: "No tienes permisos para descargar archivos académicos." });
      }

      const [attachment, material, submission] = await Promise.all([
        db.adjuntosTarea.findOne({ where: { archivoId: file.id }, include: [{ model: db.tareas, as: "tarea" }] }),
        db.materialesCurso.findOne({ where: { archivoId: file.id } }),
        db.entregasTarea.findOne({ where: { archivoId: file.id }, include: [{ model: db.tareas, as: "tarea" }] })
      ]);
      const context = attachment
        ? { cursoId: attachment.tarea.cursoId, periodoAcademicoId: attachment.tarea.periodoAcademicoId, task: attachment.tarea }
        : material
          ? { cursoId: material.cursoId, periodoAcademicoId: material.periodoAcademicoId }
          : submission
            ? { cursoId: submission.tarea.cursoId, periodoAcademicoId: submission.tarea.periodoAcademicoId, task: submission.tarea, alumnoId: submission.alumnoId }
            : null;
      if (!context) return res.status(403).send({ message: "El archivo no está asociado a un recurso académico disponible." });
      if (material && !material.activo) {
        return res.status(404).send({ message: "El material ya no está disponible." });
      }

      let allowed = false;
      if (req.userRole === ROLES.CATEDRATICO) {
        allowed = context.task
          ? await teacherCanAccessTask(req.userId, context.task)
          : Boolean(material && material.catedraticoId ===
              (await db.catedraticos.findOne({ where: { usuarioId: req.userId } }))?.id &&
              await teacherCanAccess(req.userId, context.cursoId, context.periodoAcademicoId));
      } else {
        const student = await db.alumnos.findOne({ where: { usuarioId: req.userId, activo: true } });
        if (student && submission && submission.alumnoId === student.id) allowed = true;
        if (student && !submission) {
          allowed = await studentCanAccess(req.userId, context.cursoId, context.periodoAcademicoId);
          if (context.task) {
            allowed = allowed && context.task.activo &&
              new Date(context.task.fechaPublicacion) <= new Date();
          }
        }
      }
      if (!allowed) return res.status(403).send({ message: "No tienes acceso a este archivo." });
    }

    const url = await storage.createDownloadUrl(file.storageKey, file.nombreOriginal);
    res.send({ url, expiresInSeconds: 60 });
  } catch (error) {
    res.status(error.status || 500).send({ message: error.message || "No fue posible preparar la descarga." });
  }
};
