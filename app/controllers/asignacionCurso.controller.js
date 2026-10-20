const db = require("../models");
const AsignacionCurso = db.asignacionesCurso;
const Alumno = db.alumnos;
const Curso = db.cursos;
const { getAlumnoIdsVisibles } = require("../utils/access.js");
const { seCruzan } = require("../utils/horarios.js");
const HorarioCatedratico = db.horariosCatedratico;

// RF-06 — Asignación de cursos a alumnos (RN-04: un alumno puede tener varios cursos)
exports.create = async (req, res) => {
  try {
    const { alumnoId, cursoId, periodo } = req.body;
    if (!alumnoId || !cursoId) {
      return res.status(400).send({ message: "alumnoId y cursoId son requeridos." });
    }

    const alumno = await Alumno.findByPk(alumnoId);
    if (!alumno) return res.status(404).send({ message: "El alumno indicado no existe." });

    const curso = await Curso.findByPk(cursoId);
    if (!curso) return res.status(404).send({ message: "El curso indicado no existe." });

    // RN-01/RN-02: el curso debe pertenecer a la carrera/grado del alumno.
    if (curso.gradoCarreraId !== alumno.gradoCarreraId) {
      return res.status(400).send({ message: "El curso no pertenece al grado/carrera del alumno." });
    }
    if (!alumno.activo || !curso.activo) {
      return res.status(400).send({ message: "El alumno o el curso se encuentra inactivo." });
    }

    const periodoEfectivo = periodo || "2026";

    // Evita que el alumno quede inscrito en dos cursos con horarios que se cruzan.
    const existentes = await AsignacionCurso.findAll({ where: { alumnoId, periodo: periodoEfectivo } });
    if (existentes.length > 0) {
      const [nuevos, actuales] = await Promise.all([
        HorarioCatedratico.findAll({ where: { cursoId, periodo: periodoEfectivo } }),
        HorarioCatedratico.findAll({
          where: { cursoId: existentes.map(e => e.cursoId), periodo: periodoEfectivo }
        })
      ]);
      if (nuevos.some(n => actuales.some(a => seCruzan(n, a)))) {
        return res.status(409).send({ message: "El horario del curso se cruza con otro curso del alumno." });
      }
    }

    const asignacion = await AsignacionCurso.create({
      alumnoId,
      cursoId,
      periodo: periodoEfectivo
    });
    res.send(asignacion);
  } catch (error) {
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
      return res.status(404).send({ message: `No se encontró la asignación con id=${req.params.id}.` });
    }
    const visibles = await getAlumnoIdsVisibles(req);
    if (visibles && !visibles.includes(asignacion.alumnoId)) {
      return res.status(403).send({ message: "No tienes acceso a esta asignación." });
    }
    res.send(asignacion);
  } catch (error) {
    res.status(500).send({ message: "Error al obtener la asignación." });
  }
};

exports.update = async (req, res) => {
  try {
    const [num] = await AsignacionCurso.update(req.body, { where: { id: req.params.id } });
    if (num === 1) {
      res.send({ message: "Asignación actualizada exitosamente." });
    } else {
      res.status(404).send({ message: `No se pudo actualizar la asignación con id=${req.params.id}.` });
    }
  } catch (error) {
    res.status(500).send({ message: "Error al actualizar la asignación." });
  }
};

exports.delete = async (req, res) => {
  try {
    const num = await AsignacionCurso.destroy({ where: { id: req.params.id } });
    if (num === 1) {
      res.send({ message: "Asignación eliminada exitosamente." });
    } else {
      res.status(404).send({ message: `No se pudo eliminar la asignación con id=${req.params.id}.` });
    }
  } catch (error) {
    res.status(500).send({ message: "Error al eliminar la asignación." });
  }
};

