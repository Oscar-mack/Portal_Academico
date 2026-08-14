const db = require("../models");
const AsignacionCurso = db.asignacionesCurso;
const Alumno = db.alumnos;
const Curso = db.cursos;

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

    const asignacion = await AsignacionCurso.create({
      alumnoId,
      cursoId,
      periodo: periodo || "2026"
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

