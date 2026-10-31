const { randomUUID } = require("node:crypto");
const { Op } = require("sequelize");
const db = require("../models");
const ROLES = require("../config/roles.js");
const storage = require("../services/r2Storage.js");
const { uploadMultipart } = require("../utils/academicFileUpload.js");

const Material = db.materialesCurso;

function validId(value, field) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error(`${field} debe ser un identificador válido.`), { status: 400 });
  return id;
}

function text(value, field, max, optional = false) {
  if (optional && (value === undefined || value === "")) return "";
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw Object.assign(new Error(`${field} es obligatorio y debe tener como máximo ${max} caracteres.`), { status: 400 });
  }
  return value.trim();
}

async function teacherForRequest(req) {
  const teacher = await db.catedraticos.findOne({
    where: { usuarioId: req.userId, activo: true }
  });
  if (!teacher) throw Object.assign(new Error("No tienes un perfil de catedrático activo asociado."), { status: 403 });
  return teacher;
}

async function assertTeaching(teacherId, cursoId, periodoAcademicoId) {
  if (!await db.horariosCatedratico.findOne({
    where: { catedraticoId: teacherId, cursoId, periodoAcademicoId }
  })) {
    throw Object.assign(new Error("No tienes asignado este curso y período."), { status: 403 });
  }
}

exports.findAll = async (req, res) => {
  try {
    const where = { activo: true };
    if (req.query.periodoAcademicoId !== undefined) {
      where.periodoAcademicoId = validId(req.query.periodoAcademicoId, "periodoAcademicoId");
    }
    if (req.query.cursoId !== undefined) where.cursoId = validId(req.query.cursoId, "cursoId");

    if (req.userRole === ROLES.ALUMNO) {
      const student = await db.alumnos.findOne({ where: { usuarioId: req.userId, activo: true } });
      if (!student) return res.status(403).send({ message: "No tienes un perfil de alumno activo asociado." });
      const enrollments = await db.asignacionesCurso.findAll({
        where: {
          alumnoId: student.id,
          periodoAcademicoId: { [Op.ne]: null },
          ...(where.cursoId ? { cursoId: where.cursoId } : {}),
          ...(where.periodoAcademicoId ? { periodoAcademicoId: where.periodoAcademicoId } : {})
        },
        attributes: ["cursoId", "periodoAcademicoId"]
      });
      const pairs = [...new Map(enrollments.map(item => [
        `${item.cursoId}:${item.periodoAcademicoId}`,
        { cursoId: item.cursoId, periodoAcademicoId: item.periodoAcademicoId }
      ])).values()];
      if (!pairs.length) return res.send([]);
      where[Op.or] = pairs;
    } else if (req.userRole === ROLES.CATEDRATICO) {
      const teacher = await teacherForRequest(req);
      const schedules = await db.horariosCatedratico.findAll({
        where: {
          catedraticoId: teacher.id,
          ...(where.cursoId ? { cursoId: where.cursoId } : {}),
          ...(where.periodoAcademicoId ? { periodoAcademicoId: where.periodoAcademicoId } : {})
        },
        attributes: ["cursoId", "periodoAcademicoId"]
      });
      const pairs = [...new Map(schedules.map(item => [
        `${item.cursoId}:${item.periodoAcademicoId}`,
        { cursoId: item.cursoId, periodoAcademicoId: item.periodoAcademicoId }
      ])).values()];
      if (!pairs.length) return res.send([]);
      where.catedraticoId = teacher.id;
      where[Op.or] = pairs;
    } else if (req.userRole !== ROLES.ADMIN) {
      return res.status(403).send({ message: "No tienes permisos para consultar materiales académicos." });
    }
    const rows = await Material.findAll({
      where,
      include: [
        { model: db.cursos, as: "curso", attributes: ["id", "nombre", "codigo"] },
        { model: db.periodosAcademicos, as: "periodoAcademico", attributes: ["id", "nombre"] },
        { model: db.archivosAcademicos, as: "archivo" }
      ],
      order: [["createdAt", "DESC"]]
    });
    res.send(rows.map(row => {
      const item = row.toJSON();
      if (item.archivo) {
        const { id, nombreOriginal, mimeType, sizeBytes, createdAt } = item.archivo;
        item.archivo = { id, nombreOriginal, mimeType, sizeBytes, createdAt };
      }
      return item;
    }));
  } catch (error) {
    res.status(error.status || 500).send({ message: error.message || "Error al consultar materiales." });
  }
};

exports.create = async (req, res) => {
  const key = `materials/${randomUUID()}`;
  let transaction;
  try {
    const courseId = validId(req.params.cursoId, "cursoId");
    const teacher = await teacherForRequest(req);
    const periodId = validId(req.query.periodoAcademicoId, "periodoAcademicoId");
    const course = await db.cursos.findByPk(courseId);
    if (!course || !course.activo) throw Object.assign(new Error("El curso no existe o está inactivo."), { status: 404 });
    const period = await db.periodosAcademicos.findByPk(periodId);
    if (!period) throw Object.assign(new Error("El período académico no existe."), { status: 404 });
    if (period.estado !== "abierto") {
      throw Object.assign(new Error("No se pueden publicar materiales en un período cerrado."), { status: 409 });
    }
    await assertTeaching(teacher.id, courseId, periodId);
    const uploaded = await uploadMultipart(req, key);
    const title = text(uploaded.fields.titulo, "titulo", 150);
    const description = text(uploaded.fields.descripcion, "descripcion", 2000, true);
    transaction = await db.sequelize.transaction();
    const file = await db.archivosAcademicos.create({
      storageKey: key,
      nombreOriginal: uploaded.file.nombreOriginal,
      mimeType: uploaded.file.mimeType,
      sizeBytes: uploaded.file.sizeBytes,
      sha256: uploaded.file.sha256,
      subidoPorUsuarioId: req.userId
    }, { transaction });
    const material = await Material.create({
      cursoId: courseId,
      catedraticoId: teacher.id,
      periodoAcademicoId: periodId,
      archivoId: file.id,
      titulo: title,
      descripcion: description
    }, { transaction });
    await db.auditoriaTareas.create({
      archivoId: file.id,
      usuarioId: req.userId,
      accion: "material_curso_publicado",
      detalle: JSON.stringify({ cursoId: courseId, periodoAcademicoId: periodId, titulo: title })
    }, { transaction });
    await transaction.commit();
    const { id, nombreOriginal, mimeType, sizeBytes, createdAt } = file.toJSON();
    res.status(201).send({ ...material.toJSON(), archivo: { id, nombreOriginal, mimeType, sizeBytes, createdAt } });
  } catch (error) {
    if (transaction && !transaction.finished) await transaction.rollback();
    await storage.removeObject(key).catch(() => {});
    res.status(error.status || 500).send({ message: error.message || "Error al publicar el material." });
  }
};

exports.deactivate = async (req, res) => {
  try {
    const material = await Material.findByPk(validId(req.params.id, "id"));
    if (!material) return res.status(404).send({ message: "Material no encontrado." });
    const teacher = await teacherForRequest(req);
    if (teacher.id !== material.catedraticoId) return res.status(403).send({ message: "No puedes modificar este material." });
    const period = await db.periodosAcademicos.findByPk(material.periodoAcademicoId);
    if (period?.estado !== "abierto") return res.status(409).send({ message: "No se puede desactivar material de un período cerrado." });
    await db.sequelize.transaction(async transaction => {
      await material.update({ activo: false }, { transaction });
      await db.auditoriaTareas.create({
        archivoId: material.archivoId,
        usuarioId: req.userId,
        accion: "material_curso_desactivado",
        detalle: JSON.stringify({ materialId: material.id })
      }, { transaction });
    });
    res.send({ message: "Material desactivado.", id: material.id });
  } catch (error) {
    res.status(error.status || 500).send({ message: error.message || "Error al desactivar material." });
  }
};
