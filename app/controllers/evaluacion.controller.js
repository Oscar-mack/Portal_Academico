const db = require("../models");
const ROLES = require("../config/roles.js");

const Evaluacion = db.evaluaciones;
const Calificacion = db.calificacionesEvaluacion;
const Nota = db.notas;
const AuditoriaNota = db.auditoriaNotas;
const Periodo = db.periodosAcademicos;
const Curso = db.cursos;
const Alumno = db.alumnos;
const Catedratico = db.catedraticos;
const AsignacionCurso = db.asignacionesCurso;
const Horario = db.horariosCatedratico;

const aCentavos = valor => Math.round(Number(valor) * 100);
const desdeCentavos = valor => Number((valor / 100).toFixed(2));

async function obtenerCatedratico(req, transaction, catedraticoId) {
  if (req.userRole === ROLES.ADMIN) {
    const catedratico = await Catedratico.findByPk(catedraticoId || req.body.catedraticoId, { transaction });
    return catedratico;
  }
  return Catedratico.findOne({ where: { usuarioId: req.userId }, transaction });
}

async function validarResponsabilidad(req, catedraticoId, cursoId, periodoAcademicoId, transaction) {
  const catedratico = await obtenerCatedratico(req, transaction, catedraticoId);
  if (!catedratico || (req.userRole === ROLES.CATEDRATICO && catedratico.id !== catedraticoId)) {
    return false;
  }
  const horario = await Horario.findOne({
    where: { catedraticoId, cursoId, periodoAcademicoId },
    transaction
  });
  return Boolean(horario);
}

async function validarPeriodo(periodoAcademicoId, req, transaction) {
  const periodo = await Periodo.findByPk(periodoAcademicoId, { transaction, lock: transaction?.LOCK?.UPDATE });
  if (!periodo) return { error: "El período académico no existe.", status: 404 };
  if (periodo.estado !== "abierto" && req.userRole !== ROLES.ADMIN) {
    return { error: "El período está cerrado; solo un administrador puede modificar sus notas.", status: 409 };
  }
  return { periodo };
}

async function consolidarNotaFinal({ evaluacion, alumnoId, usuarioId, motivo, transaction }) {
  const evaluaciones = await Evaluacion.findAll({
    where: {
      cursoId: evaluacion.cursoId,
      periodoAcademicoId: evaluacion.periodoAcademicoId,
      activo: true
    },
    transaction
  });
  if (evaluaciones.length === 0 ||
      evaluaciones.reduce((suma, item) => suma + aCentavos(item.puntajeMaximo), 0) !== 10000) {
    return { consolidada: false };
  }

  const ids = evaluaciones.map(item => item.id);
  const calificaciones = await Calificacion.findAll({
    where: { alumnoId, evaluacionId: ids },
    transaction
  });
  if (calificaciones.length !== evaluaciones.length) return { consolidada: false };

  const valor = desdeCentavos(calificaciones.reduce((suma, item) => suma + aCentavos(item.valor), 0));
  const periodoTextual = `academico:${evaluacion.periodoAcademicoId}`;
  let nota = await Nota.findOne({
    where: {
      alumnoId,
      cursoId: evaluacion.cursoId,
      periodoAcademicoId: evaluacion.periodoAcademicoId
    },
    transaction,
    lock: transaction.LOCK.UPDATE
  });

  if (!nota) {
    nota = await Nota.create({
      alumnoId,
      cursoId: evaluacion.cursoId,
      catedraticoId: evaluacion.catedraticoId,
      periodo: periodoTextual,
      periodoAcademicoId: evaluacion.periodoAcademicoId,
      valor
    }, { transaction });
    return { consolidada: true, nota };
  }

  if (aCentavos(nota.valor) !== aCentavos(valor)) {
    await AuditoriaNota.create({
      notaId: nota.id,
      usuarioId,
      valorAnterior: nota.valor,
      valorNuevo: valor,
      motivo: motivo || null
    }, { transaction });
    await nota.update({ valor, publicadaEn: null }, { transaction });
  }
  return { consolidada: true, nota };
}

exports.findAll = async (req, res) => {
  try {
    const where = {};
    for (const field of ["cursoId", "periodoAcademicoId"]) {
      if (req.query[field]) where[field] = req.query[field];
    }
    if (req.userRole === ROLES.CATEDRATICO) {
      const docente = await Catedratico.findOne({ where: { usuarioId: req.userId } });
      if (!docente) return res.status(403).send({ message: "No tienes perfil de catedrático asociado." });
      where.catedraticoId = docente.id;
      const horarios = await Horario.findAll({
        where: {
          catedraticoId: docente.id,
          ...(req.query.periodoAcademicoId ? { periodoAcademicoId: req.query.periodoAcademicoId } : {})
        },
        attributes: ["cursoId"]
      });
      const cursosAutorizados = [...new Set(horarios.map(horario => horario.cursoId))];
      where.cursoId = req.query.cursoId
        ? cursosAutorizados.filter(id => id === Number(req.query.cursoId))
        : cursosAutorizados;
    } else if (req.userRole !== ROLES.ADMIN) {
      return res.status(403).send({ message: "Solo administración y catedráticos pueden consultar evaluaciones." });
    }
    const rows = await Evaluacion.findAll({ where, order: [["id", "ASC"]] });
    res.send(rows);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al consultar evaluaciones." });
  }
};

exports.create = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { cursoId, periodoAcademicoId, nombre, puntajeMaximo } = req.body;
    if (!cursoId || !periodoAcademicoId || !nombre || puntajeMaximo === undefined) {
      await transaction.rollback();
      return res.status(400).send({ message: "cursoId, periodoAcademicoId, nombre y puntajeMaximo son requeridos." });
    }
    if (!Number.isFinite(Number(puntajeMaximo)) || Number(puntajeMaximo) <= 0 || Number(puntajeMaximo) > 100) {
      await transaction.rollback();
      return res.status(400).send({ message: "puntajeMaximo debe ser un número mayor que 0 y no mayor que 100." });
    }
    const validacionPeriodo = await validarPeriodo(periodoAcademicoId, req, transaction);
    if (validacionPeriodo.error) {
      await transaction.rollback();
      return res.status(validacionPeriodo.status).send({ message: validacionPeriodo.error });
    }
    const curso = await Curso.findByPk(cursoId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!curso || !curso.activo) {
      await transaction.rollback();
      return res.status(404).send({ message: "El curso no existe o está inactivo." });
    }
    const docente = await obtenerCatedratico(req, transaction);
    if (!docente) {
      await transaction.rollback();
      return res.status(400).send({ message: "Debes indicar un catedrático válido." });
    }
    const asignado = await validarResponsabilidad(req, docente.id, cursoId, periodoAcademicoId, transaction);
    if (!asignado) {
      await transaction.rollback();
      return res.status(403).send({ message: "El catedrático no tiene asignado el curso en este período." });
    }
    const notasPublicadas = await Nota.count({
      where: { cursoId, periodoAcademicoId, publicadaEn: { [db.Sequelize.Op.ne]: null } },
      transaction
    });
    if (notasPublicadas > 0) {
      await transaction.rollback();
      return res.status(409).send({ message: "No se puede cambiar la estructura de evaluaciones después de publicar notas." });
    }
    const existentes = await Evaluacion.findAll({
      where: { cursoId, periodoAcademicoId, activo: true },
      transaction
    });
    const suma = existentes.reduce((total, item) => total + aCentavos(item.puntajeMaximo), 0);
    if (suma + aCentavos(puntajeMaximo) > 10000) {
      await transaction.rollback();
      return res.status(409).send({ message: "La suma de puntajes máximos del curso y período no puede superar 100." });
    }
    const evaluacion = await Evaluacion.create({
      cursoId,
      catedraticoId: docente.id,
      periodoAcademicoId,
      nombre,
      puntajeMaximo
    }, { transaction });
    await transaction.commit();
    res.status(201).send(evaluacion);
  } catch (error) {
    await transaction.rollback();
    const status = error.name === "SequelizeUniqueConstraintError" ? 409 : 500;
    res.status(status).send({ message: error.message || "Error al crear la evaluación." });
  }
};

exports.update = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const evaluacion = await Evaluacion.findByPk(req.params.id, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!evaluacion) {
      await transaction.rollback();
      return res.status(404).send({ message: "Evaluación no encontrada." });
    }
    const periodo = await validarPeriodo(evaluacion.periodoAcademicoId, req, transaction);
    if (periodo.error) {
      await transaction.rollback();
      return res.status(periodo.status).send({ message: periodo.error });
    }
    const docente = await obtenerCatedratico(req, transaction, evaluacion.catedraticoId);
    if (!docente || (req.userRole === ROLES.CATEDRATICO && evaluacion.catedraticoId !== docente.id)) {
      await transaction.rollback();
      return res.status(403).send({ message: "No puedes modificar esta evaluación." });
    }
    if (!(await validarResponsabilidad(
      req, evaluacion.catedraticoId, evaluacion.cursoId, evaluacion.periodoAcademicoId, transaction
    ))) {
      await transaction.rollback();
      return res.status(403).send({ message: "El catedrático ya no tiene asignado el curso de esta evaluación." });
    }
    const notasPublicadas = await Nota.count({
      where: {
        cursoId: evaluacion.cursoId,
        periodoAcademicoId: evaluacion.periodoAcademicoId,
        publicadaEn: { [db.Sequelize.Op.ne]: null }
      },
      transaction
    });
    if (notasPublicadas > 0) {
      await transaction.rollback();
      return res.status(409).send({ message: "No se puede cambiar la estructura de evaluaciones después de publicar notas." });
    }

    const values = {};
    if (req.body.nombre !== undefined) values.nombre = req.body.nombre;
    if (req.body.puntajeMaximo !== undefined) {
      const maximo = Number(req.body.puntajeMaximo);
      if (!Number.isFinite(maximo) || maximo <= 0 || maximo > 100) {
        await transaction.rollback();
        return res.status(400).send({ message: "puntajeMaximo debe estar entre 0 y 100." });
      }
      const calificaciones = await Calificacion.findAll({ where: { evaluacionId: evaluacion.id }, transaction });
      if (calificaciones.some(item => aCentavos(item.valor) > aCentavos(maximo))) {
        await transaction.rollback();
        return res.status(409).send({ message: "El nuevo máximo es menor que una calificación ya registrada." });
      }
      const otras = await Evaluacion.findAll({
        where: { cursoId: evaluacion.cursoId, periodoAcademicoId: evaluacion.periodoAcademicoId, activo: true },
        transaction
      });
      const sumaOtros = otras.filter(item => item.id !== evaluacion.id)
        .reduce((suma, item) => suma + aCentavos(item.puntajeMaximo), 0);
      if (sumaOtros + aCentavos(maximo) > 10000) {
        await transaction.rollback();
        return res.status(409).send({ message: "La suma de puntajes máximos del curso y período no puede superar 100." });
      }
      values.puntajeMaximo = maximo;
    }
    await evaluacion.update(values, { transaction });
    await transaction.commit();
    res.send(evaluacion);
  } catch (error) {
    await transaction.rollback();
    const status = error.name === "SequelizeUniqueConstraintError" ? 409 : 500;
    res.status(status).send({ message: error.message || "Error al actualizar la evaluación." });
  }
};

exports.delete = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const evaluacion = await Evaluacion.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!evaluacion) {
      await transaction.rollback();
      return res.status(404).send({ message: "Evaluación no encontrada." });
    }
    const periodo = await validarPeriodo(evaluacion.periodoAcademicoId, req, transaction);
    if (periodo.error) {
      await transaction.rollback();
      return res.status(periodo.status).send({ message: periodo.error });
    }
    const docente = await obtenerCatedratico(req, transaction, evaluacion.catedraticoId);
    if (!docente || (req.userRole === ROLES.CATEDRATICO && evaluacion.catedraticoId !== docente.id)) {
      await transaction.rollback();
      return res.status(403).send({ message: "No puedes modificar esta evaluación." });
    }
    if (!(await validarResponsabilidad(
      req, evaluacion.catedraticoId, evaluacion.cursoId, evaluacion.periodoAcademicoId, transaction
    ))) {
      await transaction.rollback();
      return res.status(403).send({ message: "El catedrático ya no tiene asignado el curso de esta evaluación." });
    }
    const tieneNotas = await Calificacion.count({ where: { evaluacionId: evaluacion.id }, transaction });
    if (tieneNotas > 0) {
      await transaction.rollback();
      return res.status(409).send({ message: "No se puede desactivar una evaluación con calificaciones registradas." });
    }
    await evaluacion.update({ activo: false }, { transaction });
    await transaction.commit();
    res.send({ message: "Evaluación desactivada.", id: evaluacion.id });
  } catch (error) {
    await transaction.rollback();
    res.status(500).send({ message: error.message || "Error al desactivar la evaluación." });
  }
};

exports.getCalificaciones = async (req, res) => {
  try {
    const evaluacion = await Evaluacion.findByPk(req.params.id);
    if (!evaluacion) return res.status(404).send({ message: "Evaluación no encontrada." });
    if (req.userRole === ROLES.CATEDRATICO) {
      const docente = await Catedratico.findOne({ where: { usuarioId: req.userId } });
      const asignado = docente && await Horario.findOne({
        where: {
          catedraticoId: docente.id,
          cursoId: evaluacion.cursoId,
          periodoAcademicoId: evaluacion.periodoAcademicoId
        }
      });
      if (!docente || docente.id !== evaluacion.catedraticoId || !asignado) {
        return res.status(403).send({ message: "No puedes consultar esta evaluación." });
      }
    }
    const rows = await Calificacion.findAll({
      where: { evaluacionId: evaluacion.id },
      include: [{ model: Alumno, as: "alumno" }]
    });
    res.send(rows);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al consultar calificaciones." });
  }
};

exports.registrarCalificacion = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { alumnoId, valor, motivo } = req.body;
    const evaluacion = await Evaluacion.findByPk(req.params.id, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!evaluacion || !evaluacion.activo) {
      await transaction.rollback();
      return res.status(404).send({ message: "Evaluación no encontrada o inactiva." });
    }
    const periodo = await validarPeriodo(evaluacion.periodoAcademicoId, req, transaction);
    if (periodo.error) {
      await transaction.rollback();
      return res.status(periodo.status).send({ message: periodo.error });
    }
    const asignado = await validarResponsabilidad(
      req, evaluacion.catedraticoId, evaluacion.cursoId, evaluacion.periodoAcademicoId, transaction
    );
    if (!asignado) {
      await transaction.rollback();
      return res.status(403).send({ message: "No tienes autorización para registrar esta evaluación." });
    }
    if (!alumnoId || !Number.isFinite(Number(valor)) || Number(valor) < 0 ||
        aCentavos(valor) > aCentavos(evaluacion.puntajeMaximo)) {
      await transaction.rollback();
      return res.status(400).send({ message: "alumnoId y un valor entre 0 y el puntaje máximo son requeridos." });
    }
    const alumno = await Alumno.findByPk(alumnoId, { transaction });
    if (!alumno || !alumno.activo) {
      await transaction.rollback();
      return res.status(404).send({ message: "El alumno no existe o está inactivo." });
    }
    const curso = await Curso.findByPk(evaluacion.cursoId, { transaction });
    if (alumno.gradoCarreraId !== curso.gradoCarreraId) {
      await transaction.rollback();
      return res.status(400).send({ message: "El alumno no pertenece al grado o carrera del curso." });
    }
    const inscripcion = await AsignacionCurso.findOne({
      where: { alumnoId, cursoId: evaluacion.cursoId, periodoAcademicoId: evaluacion.periodoAcademicoId },
      transaction
    });
    if (!inscripcion) {
      await transaction.rollback();
      return res.status(400).send({ message: "El alumno no está inscrito en este curso y período." });
    }

    const [calificacion, creada] = await Calificacion.findOrCreate({
      where: { evaluacionId: evaluacion.id, alumnoId },
      defaults: { evaluacionId: evaluacion.id, alumnoId, valor },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!creada) await calificacion.update({ valor }, { transaction });
    const consolidacion = await consolidarNotaFinal({
      evaluacion,
      alumnoId,
      usuarioId: req.userId,
      motivo,
      transaction
    });
    await transaction.commit();
    res.send({ calificacion, notaFinal: consolidacion.nota || null, consolidada: consolidacion.consolidada });
  } catch (error) {
    await transaction.rollback();
    const status = error.name === "SequelizeUniqueConstraintError" ? 409 : 500;
    res.status(status).send({ message: error.message || "Error al registrar la calificación." });
  }
};

exports.validarNotaCompleta = async (nota, transaction) => {
  if (!nota.periodoAcademicoId) return true;
  const evaluaciones = await Evaluacion.findAll({
    where: { cursoId: nota.cursoId, periodoAcademicoId: nota.periodoAcademicoId, activo: true },
    transaction
  });
  if (evaluaciones.reduce((suma, item) => suma + aCentavos(item.puntajeMaximo), 0) !== 10000) return false;
  const calificaciones = await Calificacion.count({
    where: { alumnoId: nota.alumnoId, evaluacionId: evaluaciones.map(item => item.id) },
    transaction
  });
  return evaluaciones.length > 0 && calificaciones === evaluaciones.length;
};
