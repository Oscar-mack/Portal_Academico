const db = require("../models");
const AsignacionCurso = db.asignacionesCurso;
const Alumno = db.alumnos;
const Curso = db.cursos;
const { getAlumnoIdsVisibles } = require("../utils/access.js");
const { seCruzan } = require("../utils/horarios.js");
const HorarioCatedratico = db.horariosCatedratico;

// RF-06 — Asignacion de cursos a alumnos (RN-04: un alumno puede tener varios cursos)
// A2-eq: Toda la logica de validacion e insercion dentro de una transaccion con lock
//        para evitar que solicitudes concurrentes excedan cupos o dupliquen inscripciones.
exports.create = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const { alumnoId, cursoId, periodo } = req.body;
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

    const periodoEfectivo = periodo || "2026";

    // Verificar cruce de horarios dentro de la transaccion.
    const existentes = await AsignacionCurso.findAll({ where: { alumnoId, periodo: periodoEfectivo }, transaction: t });
    if (existentes.length > 0) {
      const [nuevos, actuales] = await Promise.all([
        HorarioCatedratico.findAll({ where: { cursoId, periodo: periodoEfectivo }, transaction: t }),
        HorarioCatedratico.findAll({
          where: { cursoId: existentes.map(e => e.cursoId), periodo: periodoEfectivo },
          transaction: t
        })
      ]);
      if (nuevos.some(n => actuales.some(a => seCruzan(n, a)))) {
        await t.rollback();
        return res.status(409).send({ message: "El horario del curso se cruza con otro curso del alumno." });
      }
    }

    const asignacion = await AsignacionCurso.create(
      { alumnoId, cursoId, periodo: periodoEfectivo },
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
        { model: Curso, as: "curso" }
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
        { model: Curso, as: "curso" }
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
  try {
    const [num] = await AsignacionCurso.update(req.body, { where: { id: req.params.id } });
    if (num === 1) {
      res.send({ message: "Asignacion actualizada exitosamente." });
    } else {
      res.status(404).send({ message: `No se pudo actualizar la asignacion con id=${req.params.id}.` });
    }
  } catch (error) {
    res.status(500).send({ message: "Error al actualizar la asignacion." });
  }
};

exports.delete = async (req, res) => {
  try {
    const num = await AsignacionCurso.destroy({ where: { id: req.params.id } });
    if (num === 1) {
      res.send({ message: "Asignacion eliminada exitosamente." });
    } else {
      res.status(404).send({ message: `No se pudo eliminar la asignacion con id=${req.params.id}.` });
    }
  } catch (error) {
    res.status(500).send({ message: "Error al eliminar la asignacion." });
  }
};
