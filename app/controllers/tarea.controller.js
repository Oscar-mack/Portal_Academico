const { randomUUID } = require("node:crypto");
const { Op } = require("sequelize");
const db = require("../models");
const ROLES = require("../config/roles.js");
const storage = require("../services/r2Storage.js");
const { uploadMultipart } = require("../utils/academicFileUpload.js");

const Tarea = db.tareas;
const Curso = db.cursos;
const Periodo = db.periodosAcademicos;
const Horario = db.horariosCatedratico;
const Inscripcion = db.asignacionesCurso;
const Alumno = db.alumnos;
const Adjunto = db.adjuntosTarea;
const Archivo = db.archivosAcademicos;
const Entrega = db.entregasTarea;

function parseId(value, field) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error(`${field} debe ser un identificador válido.`), { status: 400 });
  return id;
}

function validateDate(value, field) {
  const date = new Date(value);
  if (typeof value !== "string" || !value || Number.isNaN(date.getTime())) {
    throw Object.assign(new Error(`${field} debe ser una fecha ISO válida.`), { status: 400 });
  }
  return date;
}

function validateText(value, field, max) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw Object.assign(new Error(`${field} es obligatorio y debe tener como máximo ${max} caracteres.`), { status: 400 });
  }
  return value.trim();
}

async function getTeacher(req, teacherId) {
  if (req.userRole === ROLES.ADMIN) {
    if (!teacherId) throw Object.assign(new Error("Como administrador debes indicar catedraticoId."), { status: 400 });
    const teacher = await db.catedraticos.findByPk(teacherId);
    if (!teacher || !teacher.activo) throw Object.assign(new Error("El catedrático no existe o está inactivo."), { status: 404 });
    return teacher;
  }
  const teacher = await db.catedraticos.findOne({ where: { usuarioId: req.userId, activo: true } });
  if (!teacher) throw Object.assign(new Error("No tienes un perfil de catedrático activo asociado."), { status: 403 });
  return teacher;
}

async function assertTeaching(req, task) {
  if (req.userRole === ROLES.ADMIN) return;
  const teacher = await getTeacher(req);
  if (teacher.id !== task.catedraticoId || !await Horario.findOne({
    where: {
      catedraticoId: teacher.id,
      cursoId: task.cursoId,
      periodoAcademicoId: task.periodoAcademicoId
    }
  })) {
    throw Object.assign(new Error("No tienes autorización sobre este curso y período."), { status: 403 });
  }
}

async function assertPeriodOpen(periodoAcademicoId) {
  const period = await Periodo.findByPk(periodoAcademicoId);
  if (!period) throw Object.assign(new Error("El período académico no existe."), { status: 404 });
  if (period.estado !== "abierto") {
    throw Object.assign(new Error("No se pueden modificar actividades de un período cerrado."), { status: 409 });
  }
  return period;
}

function validatePeriodDates(publication, due, period) {
  const firstDay = publication.toISOString().slice(0, 10);
  const lastDay = due.toISOString().slice(0, 10);
  if (firstDay < period.fechaInicio || lastDay > period.fechaFin) {
    throw Object.assign(new Error("Las fechas de la tarea deben estar dentro del período académico."), { status: 400 });
  }
}

function parseTaskInput(input, period, partial = false) {
  const values = {};
  for (const [field, max] of [["titulo", 150], ["descripcion", 5000], ["instrucciones", 10000]]) {
    if (input[field] !== undefined || !partial) values[field] = validateText(input[field], field, max);
  }
  const publication = input.fechaPublicacion === undefined && partial
    ? null
    : validateDate(input.fechaPublicacion, "fechaPublicacion");
  const due = input.fechaLimite === undefined && partial
    ? null
    : validateDate(input.fechaLimite, "fechaLimite");
  if (publication && due && due <= publication) {
    throw Object.assign(new Error("fechaLimite debe ser posterior a fechaPublicacion."), { status: 400 });
  }
  if (publication) values.fechaPublicacion = publication;
  if (due) values.fechaLimite = due;
  const finalPublication = publication || input.currentPublication;
  const finalDue = due || input.currentDue;
  if (finalPublication && finalDue) validatePeriodDates(finalPublication, finalDue, period);
  return values;
}

function pairsForEnrollments(enrollments) {
  return [...new Map(enrollments.map(item => [
    `${item.cursoId}:${item.periodoAcademicoId}`,
    { cursoId: item.cursoId, periodoAcademicoId: item.periodoAcademicoId }
  ])).values()];
}

function taskIncludes(studentId) {
  return [
    { model: Curso, as: "curso", attributes: ["id", "nombre", "codigo"] },
    { model: Periodo, as: "periodoAcademico", attributes: ["id", "nombre", "estado"] },
    {
      model: Adjunto,
      as: "adjuntos",
      include: [{ model: Archivo, as: "archivo" }]
    },
    ...(studentId ? [{
      model: Entrega,
      as: "entregas",
      where: { alumnoId: studentId },
      required: false,
      include: [{ model: Archivo, as: "archivo" }]
    }] : [])
  ];
}

function studentTaskJson(row, now) {
  const item = row.toJSON();
  const ownDelivery = item.entregas?.sort((a, b) => new Date(b.entregadaEn) - new Date(a.entregadaEn))[0] || null;
  delete item.entregas;
  item.adjuntos = (item.adjuntos || [])
    .filter(attachment => attachment.archivo)
    .map(attachment => publicFile(attachment.archivo));
  item.miEntrega = ownDelivery
    ? { ...publicFile(ownDelivery.archivo), entregadaEn: ownDelivery.entregadaEn, id: ownDelivery.id }
    : null;
  item.estadoEntrega = ownDelivery
    ? "entregada"
    : new Date(item.fechaLimite) < now
      ? "vencida"
      : "pendiente";
  return item;
}

function publicFile(file) {
  if (!file) return null;
  const { id, nombreOriginal, mimeType, sizeBytes, createdAt } = file;
  return { id, nombreOriginal, mimeType, sizeBytes, createdAt };
}

function publicTask(row) {
  const item = row.toJSON ? row.toJSON() : row;
  item.adjuntos = (item.adjuntos || [])
    .filter(attachment => attachment.archivo)
    .map(attachment => publicFile(attachment.archivo));
  delete item.entregas;
  return item;
}

async function getTaskForRole(req, taskId, options = {}) {
  const task = await Tarea.findByPk(taskId, {
    include: taskIncludes(options.studentId)
  });
  if (!task) throw Object.assign(new Error("Tarea no encontrada."), { status: 404 });
  if (req.userRole === ROLES.ALUMNO) {
    const enrollment = await Inscripcion.findOne({
      where: {
        alumnoId: options.studentId,
        cursoId: task.cursoId,
        periodoAcademicoId: task.periodoAcademicoId
      }
    });
    if (!enrollment || !task.activo || new Date(task.fechaPublicacion) > new Date()) {
      throw Object.assign(new Error("No tienes acceso a esta tarea."), { status: 403 });
    }
  } else {
    await assertTeaching(req, task);
  }
  return task;
}

async function saveUploadedFile(req, storageKey, purpose, context, transaction) {
  const uploaded = await uploadMultipart(req, storageKey);
  let fileRecord;
  try {
    fileRecord = await Archivo.create({
      storageKey,
      nombreOriginal: uploaded.file.nombreOriginal,
      mimeType: uploaded.file.mimeType,
      sizeBytes: uploaded.file.sizeBytes,
      sha256: uploaded.file.sha256,
      subidoPorUsuarioId: req.userId
    }, { transaction });
    await db.auditoriaTareas.create({
      tareaId: context.tareaId || null,
      archivoId: fileRecord.id,
      usuarioId: req.userId,
      accion: purpose,
      detalle: JSON.stringify({ nombreOriginal: fileRecord.nombreOriginal, sizeBytes: fileRecord.sizeBytes })
    }, { transaction });
    return { fileRecord, uploaded };
  } catch (error) {
    await storage.removeObject(storageKey).catch(() => {});
    throw error;
  }
}

exports.findAll = async (req, res) => {
  try {
    const where = {};
    for (const field of ["cursoId", "periodoAcademicoId"]) {
      if (req.query[field] !== undefined) where[field] = parseId(req.query[field], field);
    }
    const now = new Date();
    let studentId;

    if (req.userRole === ROLES.ALUMNO) {
      const student = await db.alumnos.findOne({ where: { usuarioId: req.userId, activo: true } });
      if (!student) return res.status(403).send({ message: "No tienes un perfil de alumno activo asociado." });
      studentId = student.id;
      const enrollments = await Inscripcion.findAll({
        where: {
          alumnoId: studentId,
          periodoAcademicoId: { [Op.ne]: null },
          ...(where.cursoId ? { cursoId: where.cursoId } : {}),
          ...(where.periodoAcademicoId ? { periodoAcademicoId: where.periodoAcademicoId } : {})
        },
        attributes: ["cursoId", "periodoAcademicoId"]
      });
      const pairs = pairsForEnrollments(enrollments);
      if (!pairs.length) return res.send([]);
      where[Op.or] = pairs;
      where.activo = true;
      where.fechaPublicacion = { [Op.lte]: now };
    } else if (req.userRole === ROLES.CATEDRATICO) {
      const teacher = await getTeacher(req);
      const schedules = await Horario.findAll({
        where: {
          catedraticoId: teacher.id,
          ...(where.periodoAcademicoId ? { periodoAcademicoId: where.periodoAcademicoId } : {}),
          ...(where.cursoId ? { cursoId: where.cursoId } : {})
        },
        attributes: ["cursoId", "periodoAcademicoId"]
      });
      const pairs = pairsForEnrollments(schedules);
      if (!pairs.length) return res.send([]);
      where.catedraticoId = teacher.id;
      where[Op.or] = pairs;
    } else if (req.userRole !== ROLES.ADMIN) {
      return res.status(403).send({ message: "Este módulo está disponible para administración, docentes y alumnos." });
    }

    let rows = await Tarea.findAll({
      where,
      include: taskIncludes(studentId),
      order: [["fechaLimite", "ASC"], ["id", "ASC"]]
    });
    let result = rows.map(row => studentId ? studentTaskJson(row, now) : publicTask(row));
    if (studentId && req.query.estado) {
      if (!["pendiente", "entregada", "vencida"].includes(req.query.estado)) {
        return res.status(400).send({ message: "estado debe ser pendiente, entregada o vencida." });
      }
      result = result.filter(task => task.estadoEntrega === req.query.estado);
    }
    res.send(result);
  } catch (error) {
    res.status(error.status || 500).send({ message: error.message || "Error al consultar tareas." });
  }
};

exports.findOne = async (req, res) => {
  try {
    const taskId = parseId(req.params.id, "id");
    const student = req.userRole === ROLES.ALUMNO
      ? await db.alumnos.findOne({ where: { usuarioId: req.userId, activo: true } })
      : null;
    if (req.userRole === ROLES.ALUMNO && !student) {
      return res.status(403).send({ message: "No tienes un perfil de alumno activo asociado." });
    }
    const task = await getTaskForRole(req, taskId, { studentId: student?.id });
    res.send(student ? studentTaskJson(task, new Date()) : publicTask(task));
  } catch (error) {
    res.status(error.status || 500).send({ message: error.message || "Error al consultar la tarea." });
  }
};

exports.create = async (req, res) => {
  try {
    const cursoId = parseId(req.body.cursoId, "cursoId");
    const periodoAcademicoId = parseId(req.body.periodoAcademicoId, "periodoAcademicoId");
    const teacher = await getTeacher(req, req.body.catedraticoId);
    const course = await Curso.findByPk(cursoId);
    if (!course || !course.activo) return res.status(404).send({ message: "El curso no existe o está inactivo." });
    const period = await assertPeriodOpen(periodoAcademicoId);
    if (!await Horario.findOne({ where: { catedraticoId: teacher.id, cursoId, periodoAcademicoId } })) {
      return res.status(403).send({ message: "El catedrático no tiene asignado el curso en este período." });
    }
    const values = parseTaskInput(req.body, period);
    const task = await db.sequelize.transaction(async transaction => {
      const created = await Tarea.create({
        ...values, cursoId, periodoAcademicoId, catedraticoId: teacher.id
      }, { transaction });
      await db.auditoriaTareas.create({
        tareaId: created.id,
        usuarioId: req.userId,
        accion: "tarea_creada",
        detalle: JSON.stringify({ cursoId, periodoAcademicoId })
      }, { transaction });
      return created;
    });
    res.status(201).send(task);
  } catch (error) {
    res.status(error.status || 500).send({ message: error.message || "Error al crear la tarea." });
  }
};

exports.update = async (req, res) => {
  try {
    const task = await Tarea.findByPk(parseId(req.params.id, "id"));
    if (!task) return res.status(404).send({ message: "Tarea no encontrada." });
    await assertTeaching(req, task);
    const period = await assertPeriodOpen(task.periodoAcademicoId);
    if (await Entrega.count({ where: { tareaId: task.id } })) {
      return res.status(409).send({ message: "No se puede editar una tarea después de recibir entregas." });
    }
    const allowed = ["titulo", "descripcion", "instrucciones", "fechaPublicacion", "fechaLimite"];
    if (!Object.keys(req.body).length || Object.keys(req.body).some(field => !allowed.includes(field))) {
      return res.status(400).send({ message: "Solo se permite editar título, descripción, instrucciones y fechas." });
    }
    const values = parseTaskInput({
      ...req.body,
      currentPublication: new Date(task.fechaPublicacion),
      currentDue: new Date(task.fechaLimite)
    }, period, true);
    const updated = await db.sequelize.transaction(async transaction => {
      await task.update(values, { transaction });
      await db.auditoriaTareas.create({
        tareaId: task.id,
        usuarioId: req.userId,
        accion: "tarea_editada",
        detalle: JSON.stringify(Object.keys(values))
      }, { transaction });
      return task;
    });
    res.send(updated);
  } catch (error) {
    res.status(error.status || 500).send({ message: error.message || "Error al editar la tarea." });
  }
};

exports.deactivate = async (req, res) => {
  try {
    const task = await Tarea.findByPk(parseId(req.params.id, "id"));
    if (!task) return res.status(404).send({ message: "Tarea no encontrada." });
    await assertTeaching(req, task);
    await assertPeriodOpen(task.periodoAcademicoId);
    if (!task.activo) return res.status(409).send({ message: "La tarea ya está desactivada." });
    if (await Entrega.count({ where: { tareaId: task.id } })) {
      return res.status(409).send({ message: "No se puede desactivar una tarea con entregas; se conserva su historial académico." });
    }
    await db.sequelize.transaction(async transaction => {
      await task.update({ activo: false }, { transaction });
      await db.auditoriaTareas.create({
        tareaId: task.id,
        usuarioId: req.userId,
        accion: "tarea_desactivada"
      }, { transaction });
    });
    res.send({ message: "Tarea desactivada.", id: task.id });
  } catch (error) {
    res.status(error.status || 500).send({ message: error.message || "Error al desactivar la tarea." });
  }
};

exports.addAttachment = async (req, res) => {
  const key = `tasks/${randomUUID()}`;
  let transaction;
  try {
    const task = await Tarea.findByPk(parseId(req.params.id, "id"));
    if (!task) return res.status(404).send({ message: "Tarea no encontrada." });
    await assertTeaching(req, task);
    await assertPeriodOpen(task.periodoAcademicoId);
    transaction = await db.sequelize.transaction();
    const { fileRecord } = await saveUploadedFile(req, key, "adjunto_tarea_subido", { tareaId: task.id }, transaction);
    const attachment = await Adjunto.create({ tareaId: task.id, archivoId: fileRecord.id }, { transaction });
    await transaction.commit();
    res.status(201).send({
      ...attachment.toJSON(),
      archivo: publicFile(fileRecord.toJSON())
    });
  } catch (error) {
    if (transaction && !transaction.finished) await transaction.rollback();
    await storage.removeObject(key).catch(() => {});
    res.status(error.status || 500).send({ message: error.message || "Error al adjuntar el archivo." });
  }
};

exports.getSubmissions = async (req, res) => {
  try {
    const task = await Tarea.findByPk(parseId(req.params.id, "id"));
    if (!task) return res.status(404).send({ message: "Tarea no encontrada." });
    await assertTeaching(req, task);
    const [enrollments, submissions] = await Promise.all([
      Inscripcion.findAll({
        where: { cursoId: task.cursoId, periodoAcademicoId: task.periodoAcademicoId },
        include: [{ model: Alumno, as: "alumno", attributes: ["id", "nombre", "apellido", "email"] }]
      }),
      Entrega.findAll({
        where: { tareaId: task.id },
        include: [{ model: Archivo, as: "archivo" }],
        order: [["entregadaEn", "DESC"]]
      })
    ]);
    const latest = new Map();
    submissions.forEach(submission => {
      if (!latest.has(submission.alumnoId)) latest.set(submission.alumnoId, submission);
    });
    const now = new Date();
    res.send(enrollments.map(enrollment => {
      const submission = latest.get(enrollment.alumnoId);
      return {
        alumno: enrollment.alumno,
        estado: submission ? "entregada" : new Date(task.fechaLimite) < now ? "vencida" : "pendiente",
        entrega: submission ? {
          id: submission.id,
          entregadaEn: submission.entregadaEn,
          archivo: publicFile(submission.archivo)
        } : null
      };
    }));
  } catch (error) {
    res.status(error.status || 500).send({ message: error.message || "Error al consultar entregas." });
  }
};

exports.submit = async (req, res) => {
  const key = `submissions/${randomUUID()}`;
  let transaction;
  try {
    const student = await db.alumnos.findOne({ where: { usuarioId: req.userId, activo: true } });
    if (!student) return res.status(403).send({ message: "No tienes un perfil de alumno activo asociado." });
    const task = await Tarea.findByPk(parseId(req.params.id, "id"));
    if (!task || !task.activo || new Date(task.fechaPublicacion) > new Date()) {
      return res.status(404).send({ message: "La tarea no está disponible." });
    }
    const now = new Date();
    if (new Date(task.fechaLimite) < now) return res.status(409).send({ message: "El plazo de entrega venció." });
    const enrollment = await Inscripcion.findOne({
      where: { alumnoId: student.id, cursoId: task.cursoId, periodoAcademicoId: task.periodoAcademicoId }
    });
    if (!enrollment) return res.status(403).send({ message: "No estás inscrito en el curso y período de esta tarea." });
    const period = await Periodo.findByPk(task.periodoAcademicoId);
    if (period?.estado !== "abierto") return res.status(409).send({ message: "No se pueden registrar entregas en un período cerrado." });
    transaction = await db.sequelize.transaction();
    const { fileRecord } = await saveUploadedFile(req, key, "entrega_tarea_subida", { tareaId: task.id }, transaction);
    const delivery = await Entrega.create({
      tareaId: task.id,
      alumnoId: student.id,
      archivoId: fileRecord.id,
      entregadaEn: now
    }, { transaction });
    await transaction.commit();
    res.status(201).send({
      ...delivery.toJSON(),
      archivo: publicFile(fileRecord.toJSON())
    });
  } catch (error) {
    if (transaction && !transaction.finished) await transaction.rollback();
    await storage.removeObject(key).catch(() => {});
    res.status(error.status || 500).send({ message: error.message || "Error al registrar la entrega." });
  }
};

exports.mySubmission = async (req, res) => {
  try {
    const student = await db.alumnos.findOne({ where: { usuarioId: req.userId, activo: true } });
    if (!student) return res.status(403).send({ message: "No tienes un perfil de alumno activo asociado." });
    const task = await Tarea.findByPk(parseId(req.params.id, "id"));
    if (!task || !task.activo || new Date(task.fechaPublicacion) > new Date()) {
      return res.status(404).send({ message: "La tarea no está disponible." });
    }
    const enrollment = await Inscripcion.findOne({
      where: { alumnoId: student.id, cursoId: task.cursoId, periodoAcademicoId: task.periodoAcademicoId }
    });
    if (!enrollment) return res.status(403).send({ message: "No tienes acceso a esta tarea." });
    const submission = await Entrega.findOne({
      where: { tareaId: task.id, alumnoId: student.id },
      include: [{ model: Archivo, as: "archivo" }],
      order: [["entregadaEn", "DESC"]]
    });
    res.send(submission ? {
      id: submission.id,
      tareaId: submission.tareaId,
      alumnoId: submission.alumnoId,
      entregadaEn: submission.entregadaEn,
      archivo: publicFile(submission.archivo?.toJSON())
    } : null);
  } catch (error) {
    res.status(error.status || 500).send({ message: error.message || "Error al consultar tu entrega." });
  }
};

exports.parseId = parseId;
exports.getTaskForRole = getTaskForRole;
