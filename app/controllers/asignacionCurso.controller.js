const db = require("../models");
const AsignacionCurso = db.asignacionesCurso;
const Alumno = db.alumnos;
const Curso = db.cursos;
const { getAlumnoIdsVisibles } = require("../utils/access.js");
const { seCruzan } = require("../utils/horarios.js");
const HorarioCatedratico = db.horariosCatedratico;
const ROLES = require("../config/roles.js");

async function enrollStudentFromSession(req, res) {
  const transaction = await db.sequelize.transaction();
  try {
    if (Object.keys(req.body).length !== 1 || req.body.alumnoId !== undefined || req.body.cursoId !== undefined) {
      await transaction.rollback();
      return res.status(400).send({
        message: "Para inscribirte envía únicamente ofertaCursoId; el alumno y el curso se identifican desde tu sesión y la sección."
      });
    }
    const ofertaCursoId = Number(req.body.ofertaCursoId);
    if (!Number.isInteger(ofertaCursoId) || ofertaCursoId <= 0) {
      await transaction.rollback();
      return res.status(400).send({ message: "ofertaCursoId debe ser un identificador válido." });
    }
    const alumno = await Alumno.findOne({
      where: { usuarioId: req.userId, activo: true },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!alumno) {
      await transaction.rollback();
      return res.status(404).send({ message: "La cuenta no tiene un perfil de alumno activo." });
    }
    const oferta = await db.ofertasCurso.findByPk(ofertaCursoId, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!oferta || !oferta.activo) {
      await transaction.rollback();
      return res.status(404).send({ message: "La sección no existe o está desactivada." });
    }
    const periodo = await db.periodosAcademicos.findByPk(oferta.periodoAcademicoId, {
      transaction,
      include: [{ model: db.ciclosAcademicos, as: "cicloAcademico" }]
    });
    if (!periodo || periodo.estado !== "abierto" || periodo.cicloAcademico?.estado !== "abierto") {
      await transaction.rollback();
      return res.status(409).send({ message: "El período académico de la sección está cerrado." });
    }
    const hoy = new Date().toISOString().slice(0, 10);
    if (hoy < oferta.fechaInscripcionInicio) {
      await transaction.rollback();
      return res.status(409).send({ message: `La inscripción para esta sección abre el ${oferta.fechaInscripcionInicio}.` });
    }
    if (hoy > oferta.fechaInscripcionFin) {
      await transaction.rollback();
      return res.status(409).send({ message: `La inscripción para esta sección cerró el ${oferta.fechaInscripcionFin}.` });
    }
    const curso = await Curso.findByPk(oferta.cursoId, { transaction });
    if (!curso || !curso.activo) {
      await transaction.rollback();
      return res.status(409).send({ message: "El curso de esta sección está inactivo." });
    }
    if (curso.gradoCarreraId !== alumno.gradoCarreraId) {
      await transaction.rollback();
      return res.status(403).send({ message: "Esta sección no pertenece a tu programa académico." });
    }
    const catedratico = await db.catedraticos.findByPk(oferta.catedraticoId, { transaction });
    if (!catedratico || !catedratico.activo) {
      await transaction.rollback();
      return res.status(409).send({ message: "El catedrático de esta sección está inactivo." });
    }
    const duplicada = await AsignacionCurso.findOne({
      where: { alumnoId: alumno.id, cursoId: curso.id, periodoAcademicoId: periodo.id },
      transaction
    });
    if (duplicada) {
      await transaction.rollback();
      return res.status(409).send({ message: "Ya estás inscrito en este curso durante el período seleccionado." });
    }
    const horariosNuevos = await HorarioCatedratico.findAll({
      where: { ofertaCursoId: oferta.id },
      transaction
    });
    if (!horariosNuevos.length) {
      await transaction.rollback();
      return res.status(409).send({ message: "La sección aún no tiene horario configurado; consulta con administración." });
    }
    const existentes = await AsignacionCurso.findAll({
      where: { alumnoId: alumno.id, periodoAcademicoId: periodo.id },
      attributes: ["cursoId", "ofertaCursoId"],
      transaction
    });
    if (existentes.length) {
      const ofertaIds = existentes.map(item => item.ofertaCursoId).filter(Boolean);
      const legacyCourseIds = existentes.filter(item => !item.ofertaCursoId).map(item => item.cursoId);
      const scheduleScopes = [];
      if (ofertaIds.length) scheduleScopes.push({ ofertaCursoId: ofertaIds });
      if (legacyCourseIds.length) {
        scheduleScopes.push({ cursoId: legacyCourseIds, ofertaCursoId: null });
      }
      const horariosActuales = scheduleScopes.length
        ? await HorarioCatedratico.findAll({
          where: {
            periodoAcademicoId: periodo.id,
            [db.Sequelize.Op.or]: scheduleScopes
          },
          transaction
        })
        : [];
      if (horariosNuevos.some(nuevo => horariosActuales.some(actual => seCruzan(nuevo, actual)))) {
        await transaction.rollback();
        return res.status(409).send({ message: "El horario de esta sección se cruza con otro curso en el período seleccionado." });
      }
    }
    const inscritos = await AsignacionCurso.count({
      where: { ofertaCursoId: oferta.id },
      transaction
    });
    if (inscritos >= oferta.cupoMaximo) {
      await transaction.rollback();
      return res.status(409).send({ message: "La sección ya no tiene cupos disponibles." });
    }
    const asignacion = await AsignacionCurso.create({
      alumnoId: alumno.id,
      cursoId: curso.id,
      periodo: `academico:${periodo.id}`,
      periodoAcademicoId: periodo.id,
      ofertaCursoId: oferta.id
    }, { transaction });
    await transaction.commit();
    return res.status(201).send(asignacion);
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(409).send({ message: "Ya estás inscrito en este curso durante el período seleccionado." });
    }
    return res.status(500).send({ message: error.message || "No fue posible completar la inscripción." });
  }
}

// RF-06 — Asignacion de cursos a alumnos (RN-04: un alumno puede tener varios cursos)
// A2-eq: Toda la logica de validacion e insercion dentro de una transaccion con lock
//        para evitar que solicitudes concurrentes excedan cupos o dupliquen inscripciones.
exports.create = async (req, res) => {
  if (req.userRole === ROLES.ALUMNO) return enrollStudentFromSession(req, res);
  const t = await db.sequelize.transaction();
  try {
    const { alumnoId, cursoId, periodo, periodoAcademicoId } = req.body;
    if (!alumnoId || !cursoId) {
      await t.rollback();
      return res.status(400).send({ message: "alumnoId y cursoId son requeridos." });
    }

    const alumno = await Alumno.findByPk(alumnoId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!alumno) {
      await t.rollback();
      return res.status(404).send({ message: "El alumno indicado no existe." });
    }

    const curso = await Curso.findByPk(cursoId, { transaction: t });
    if (!curso) {
      await t.rollback();
      return res.status(404).send({ message: "El curso indicado no existe." });
    }

    // RN-01/RN-02: el curso debe pertenecer a la carrera/grado del alumno.
    if (curso.gradoCarreraId !== alumno.gradoCarreraId) {
      await t.rollback();
      return res.status(400).send({ message: "El curso no pertenece al grado/carrera del alumno." });
    }
    if (!alumno.activo || !curso.activo) {
      await t.rollback();
      return res.status(400).send({ message: "El alumno o el curso se encuentra inactivo." });
    }

    let periodoAcademico = null;
    if (periodoAcademicoId) {
      periodoAcademico = await db.periodosAcademicos.findByPk(periodoAcademicoId, { transaction: t });
      if (!periodoAcademico) {
        await t.rollback();
        return res.status(404).send({ message: "El período académico indicado no existe." });
      }
      if (periodoAcademico.estado !== "abierto") {
        await t.rollback();
        return res.status(409).send({ message: "No se puede inscribir un alumno en un período cerrado." });
      }
    }
    const periodoEfectivo = periodoAcademico ? `academico:${periodoAcademico.id}` : (periodo || "2026");
    const filtroPeriodo = periodoAcademico
      ? { periodoAcademicoId: periodoAcademico.id }
      : { periodo: periodoEfectivo };

    // Verificar cruce de horarios dentro de la transaccion.
    const existentes = await AsignacionCurso.findAll({ where: { alumnoId, ...filtroPeriodo }, transaction: t });
    if (existentes.length > 0) {
      const [nuevos, actuales] = await Promise.all([
        HorarioCatedratico.findAll({ where: { cursoId, ...filtroPeriodo }, transaction: t }),
        HorarioCatedratico.findAll({
          where: { cursoId: existentes.map(e => e.cursoId), ...filtroPeriodo },
          transaction: t
        })
      ]);
      if (nuevos.some(n => actuales.some(a => seCruzan(n, a)))) {
        await t.rollback();
        return res.status(409).send({ message: "El horario del curso se cruza con otro curso del alumno." });
      }
    }

    const asignacion = await AsignacionCurso.create(
      {
        alumnoId,
        cursoId,
        periodo: periodoEfectivo,
        ...(periodoAcademico ? { periodoAcademicoId: periodoAcademico.id } : {})
      },
      { transaction: t }
    );
    await t.commit();
    res.send(asignacion);
  } catch (error) {
    await t.rollback();
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(409).send({ message: "El alumno ya tiene asignado este curso en el periodo indicado." });
    }
    res.status(500).send({ message: error.message || "Error al asignar el curso." });
  }
};

exports.findAll = async (req, res) => {
  try {
    const where = {};
    if (req.query.alumnoId) where.alumnoId = req.query.alumnoId;
    if (req.query.cursoId) where.cursoId = req.query.cursoId;
    if (req.query.periodoAcademicoId) where.periodoAcademicoId = req.query.periodoAcademicoId;
    if (req.query.periodo) where.periodo = req.query.periodo;

    const visibles = await getAlumnoIdsVisibles(req);
    if (visibles) {
      where.alumnoId = req.query.alumnoId
        ? visibles.filter(id => id === Number(req.query.alumnoId))
        : visibles;
    }

    const asignaciones = await AsignacionCurso.findAll({
      where,
      include: [
        { model: Alumno, as: "alumno" },
        { model: Curso, as: "curso" },
        { model: db.ofertasCurso, as: "ofertaCurso" }
      ]
    });
    res.send(asignaciones);
  } catch (error) {
    res.status(500).send({ message: "Error al obtener las asignaciones." });
  }
};

exports.findOne = async (req, res) => {
  try {
    const asignacion = await AsignacionCurso.findByPk(req.params.id, {
      include: [
        { model: Alumno, as: "alumno" },
        { model: Curso, as: "curso" },
        { model: db.ofertasCurso, as: "ofertaCurso" }
      ]
    });
    if (!asignacion) {
      return res.status(404).send({ message: `No se encontro la asignacion con id=${req.params.id}.` });
    }
    const visibles = await getAlumnoIdsVisibles(req);
    if (visibles && !visibles.includes(asignacion.alumnoId)) {
      return res.status(403).send({ message: "No tienes acceso a esta asignacion." });
    }
    res.send(asignacion);
  } catch (error) {
    res.status(500).send({ message: "Error al obtener la asignacion." });
  }
};

exports.update = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const asignacion = await AsignacionCurso.findByPk(req.params.id, {
      transaction: t,
      lock: t.LOCK.UPDATE
    });
    if (!asignacion) {
      await t.rollback();
      return res.status(404).send({ message: `No se encontro la asignacion con id=${req.params.id}.` });
    }
    if (asignacion.ofertaCursoId && Object.keys(req.body).some(field =>
      ["alumnoId", "cursoId", "periodo", "periodoAcademicoId"].includes(field)
    )) {
      await t.rollback();
      return res.status(409).send({ message: "No se puede modificar una inscripción asociada a una sección; se conserva el historial de inscripción." });
    }
    const allowed = ["alumnoId", "cursoId", "periodo", "periodoAcademicoId"];
    if (Object.keys(req.body).some(field => !allowed.includes(field)) ||
        !Object.keys(req.body).some(field => allowed.includes(field))) {
      await t.rollback();
      return res.status(400).send({ message: "Indica únicamente alumnoId, cursoId, periodo o periodoAcademicoId." });
    }
    const alumnoId = req.body.alumnoId === undefined ? asignacion.alumnoId : Number(req.body.alumnoId);
    const cursoId = req.body.cursoId === undefined ? asignacion.cursoId : Number(req.body.cursoId);
    const periodoAcademicoId = req.body.periodoAcademicoId === undefined
      ? asignacion.periodoAcademicoId
      : (req.body.periodoAcademicoId === null ? null : Number(req.body.periodoAcademicoId));
    if (!Number.isInteger(alumnoId) || !Number.isInteger(cursoId) ||
        (periodoAcademicoId !== null && !Number.isInteger(periodoAcademicoId))) {
      await t.rollback();
      return res.status(400).send({ message: "Los identificadores deben ser enteros válidos." });
    }
    const alumno = await Alumno.findByPk(alumnoId, { transaction: t, lock: t.LOCK.UPDATE });
    const curso = await Curso.findByPk(cursoId, { transaction: t });
    if (!alumno || !curso) {
      await t.rollback();
      return res.status(404).send({ message: "El alumno o curso indicado no existe." });
    }
    if (!alumno.activo || !curso.activo || curso.gradoCarreraId !== alumno.gradoCarreraId) {
      await t.rollback();
      return res.status(400).send({ message: "Alumno y curso deben estar activos y pertenecer al mismo grado o carrera." });
    }
    let periodoAcademico = null;
    if (periodoAcademicoId !== null) {
      periodoAcademico = await db.periodosAcademicos.findByPk(periodoAcademicoId, {
        transaction: t,
        lock: t.LOCK.UPDATE
      });
      if (!periodoAcademico) {
        await t.rollback();
        return res.status(404).send({ message: "El período académico indicado no existe." });
      }
      if (periodoAcademico.estado !== "abierto") {
        await t.rollback();
        return res.status(409).send({ message: "No se puede modificar una inscripción de un período cerrado." });
      }
    }
    const periodo = periodoAcademico
      ? `academico:${periodoAcademico.id}`
      : (req.body.periodo || asignacion.periodo);
    if (typeof periodo !== "string" || !periodo.trim()) {
      await t.rollback();
      return res.status(400).send({ message: "periodo debe ser una cadena no vacía." });
    }

    const cambiaronReferencias = alumnoId !== asignacion.alumnoId ||
      cursoId !== asignacion.cursoId ||
      periodoAcademicoId !== asignacion.periodoAcademicoId ||
      periodo !== asignacion.periodo;
    if (cambiaronReferencias) {
      if (asignacion.periodoAcademicoId && await db.tareas.count({
        where: {
          cursoId: asignacion.cursoId,
          periodoAcademicoId: asignacion.periodoAcademicoId
        },
        transaction: t
      })) {
        await t.rollback();
        return res.status(409).send({ message: "No se puede cambiar una inscripción relacionada con tareas; se conserva el historial académico." });
      }
      const notaWhere = {
        alumnoId: asignacion.alumnoId,
        cursoId: asignacion.cursoId,
        ...(asignacion.periodoAcademicoId
          ? { periodoAcademicoId: asignacion.periodoAcademicoId }
          : { periodo: asignacion.periodo })
      };
      const notaExistente = await db.notas.count({ where: notaWhere, transaction: t });
      let calificacionesExistentes = 0;
      if (asignacion.periodoAcademicoId) {
        const evaluaciones = await db.evaluaciones.findAll({
          where: { cursoId: asignacion.cursoId, periodoAcademicoId: asignacion.periodoAcademicoId },
          attributes: ["id"],
          transaction: t
        });
        if (evaluaciones.length) {
          calificacionesExistentes = await db.calificacionesEvaluacion.count({
            where: {
              alumnoId: asignacion.alumnoId,
              evaluacionId: evaluaciones.map(evaluacion => evaluacion.id)
            },
            transaction: t
          });
        }
      }
      if (notaExistente || calificacionesExistentes) {
        await t.rollback();
        return res.status(409).send({ message: "No se puede cambiar una inscripción con calificaciones registradas." });
      }
    }
    const filtroPeriodo = periodoAcademico
      ? { periodoAcademicoId: periodoAcademico.id }
      : { periodo };
    const duplicada = await AsignacionCurso.findOne({
      where: {
        alumnoId,
        cursoId,
        ...filtroPeriodo,
        id: { [db.Sequelize.Op.ne]: asignacion.id }
      },
      transaction: t
    });
    if (duplicada) {
      await t.rollback();
      return res.status(409).send({ message: "El alumno ya tiene asignado este curso en el período indicado." });
    }
    const existentes = await AsignacionCurso.findAll({
      where: {
        alumnoId,
        ...filtroPeriodo,
        id: { [db.Sequelize.Op.ne]: asignacion.id }
      },
      transaction: t
    });
    const [nuevos, actuales] = await Promise.all([
      HorarioCatedratico.findAll({ where: { cursoId, ...filtroPeriodo }, transaction: t }),
      existentes.length
        ? HorarioCatedratico.findAll({
          where: { cursoId: existentes.map(item => item.cursoId), ...filtroPeriodo },
          transaction: t
        })
        : []
    ]);
    if (nuevos.some(nuevo => actuales.some(actual => seCruzan(nuevo, actual)))) {
      await t.rollback();
      return res.status(409).send({ message: "El horario del curso se cruza con otro curso del alumno." });
    }
    await asignacion.update({
      alumnoId,
      cursoId,
      periodo,
      periodoAcademicoId
    }, { transaction: t });
    await t.commit();
    return res.send(asignacion);
  } catch (error) {
    await t.rollback();
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(409).send({ message: "El alumno ya tiene asignado este curso en el período indicado." });
    }
    return res.status(500).send({ message: error.message || "Error al actualizar la asignacion." });
  }
};

exports.delete = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const asignacion = await AsignacionCurso.findByPk(req.params.id, {
      transaction: t,
      lock: t.LOCK.UPDATE
    });
    if (!asignacion) {
      await t.rollback();
      return res.status(404).send({ message: `No se pudo eliminar la asignacion con id=${req.params.id}.` });
    }
    const notaWhere = {
      alumnoId: asignacion.alumnoId,
      cursoId: asignacion.cursoId,
      ...(asignacion.periodoAcademicoId
        ? { periodoAcademicoId: asignacion.periodoAcademicoId }
        : { periodo: asignacion.periodo })
    };
    const notaExistente = await db.notas.count({ where: notaWhere, transaction: t });
    const tareasExistentes = asignacion.periodoAcademicoId
      ? await db.tareas.count({
        where: {
          cursoId: asignacion.cursoId,
          periodoAcademicoId: asignacion.periodoAcademicoId
        },
        transaction: t
      })
      : 0;
    let calificacionesExistentes = 0;
    if (asignacion.periodoAcademicoId) {
      const evaluaciones = await db.evaluaciones.findAll({
        where: { cursoId: asignacion.cursoId, periodoAcademicoId: asignacion.periodoAcademicoId },
        attributes: ["id"],
        transaction: t
      });
      if (evaluaciones.length) {
        calificacionesExistentes = await db.calificacionesEvaluacion.count({
          where: {
            alumnoId: asignacion.alumnoId,
            evaluacionId: evaluaciones.map(evaluacion => evaluacion.id)
          },
          transaction: t
        });
      }
    }
    if (notaExistente || calificacionesExistentes || tareasExistentes) {
      await t.rollback();
      return res.status(409).send({ message: tareasExistentes
        ? "No se puede eliminar una inscripción relacionada con tareas; se conserva el historial académico."
        : "No se puede eliminar una inscripción con calificaciones registradas." });
    }
    await asignacion.destroy({ transaction: t });
    await t.commit();
    return res.send({ message: "Asignacion eliminada exitosamente." });
  } catch (error) {
    await t.rollback();
    return res.status(500).send({ message: error.message || "Error al eliminar la asignacion." });
  }
};
