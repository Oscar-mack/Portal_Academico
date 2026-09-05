const db = require("../models");
const ROLES = require("../config/roles.js");

const Nota = db.notas;
const Alumno = db.alumnos;
const Curso = db.cursos;
const Catedratico = db.catedraticos;
const AsignacionCurso = db.asignacionesCurso;
const HorarioCatedratico = db.horariosCatedratico;
const PadreAlumno = db.padresAlumnos;

// RF-07 — Registro de notas.
// RN-05 — Solo el catedrático responsable de un curso podrá registrar sus calificaciones.
exports.create = async (req, res) => {
  try {
    const { alumnoId, cursoId, valor, periodo } = req.body;
    if (!alumnoId || !cursoId || valor === undefined) {
      return res.status(400).send({ message: "alumnoId, cursoId y valor son requeridos." });
    }
    if (valor < 0 || valor > 100) {
      return res.status(400).send({ message: "El valor de la nota debe estar entre 0 y 100." });
    }

    // Determinar el catedratico responsable según el rol de quien hace la petición
    let catedraticoId;
    if (req.userRole === ROLES.ADMIN) {
      catedraticoId = req.body.catedraticoId;
      if (!catedraticoId) {
        return res.status(400).send({ message: "Como administrador, debes indicar catedraticoId." });
      }
    } else {
      const catedratico = await Catedratico.findOne({ where: { usuarioId: req.userId } });
      if (!catedratico) {
        return res.status(403).send({ message: "Tu usuario no tiene un perfil de catedrático asociado." });
      }
      catedraticoId = catedratico.id;
    }

    // RN-05: validar que el catedratico efectivamente imparte ese curso
    const responsable = await HorarioCatedratico.findOne({ where: { catedraticoId, cursoId } });
    if (!responsable) {
      return res.status(403).send({
        message: "Este catedrático no tiene asignado el curso indicado; no puede registrar notas en él."
      });
    }

    // Validar que el alumno esté inscrito en el curso
    const inscripcion = await AsignacionCurso.findOne({ where: { alumnoId, cursoId } });
    if (!inscripcion) {
      return res.status(400).send({ message: "El alumno no está inscrito en este curso." });
    }

    const nota = await Nota.create({
      alumnoId, cursoId, catedraticoId, valor, periodo: periodo || "2026"
    });
    res.send(nota);
  } catch (error) {
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(409).send({ message: "Ya existe una nota registrada para este alumno en este curso y periodo. Usa actualizar." });
    }
    res.status(500).send({ message: error.message || "Error al registrar la nota." });
  }
};

// RF-08 — Consulta de notas, con visibilidad restringida por rol.
exports.findAll = async (req, res) => {
  try {
    const where = {};
    if (req.query.cursoId) where.cursoId = req.query.cursoId;
    if (req.query.periodo) where.periodo = req.query.periodo;

    if (req.userRole === ROLES.ADMIN) {
      // el admin puede ver todo, opcionalmente filtrar por alumnoId/catedraticoId
      if (req.query.alumnoId) where.alumnoId = req.query.alumnoId;
      if (req.query.catedraticoId) where.catedraticoId = req.query.catedraticoId;
    } else if (req.userRole === ROLES.CATEDRATICO) {
      const catedratico = await Catedratico.findOne({ where: { usuarioId: req.userId } });
      if (!catedratico) return res.status(403).send({ message: "No tienes un perfil de catedrático asociado." });
      where.catedraticoId = catedratico.id;
    } else if (req.userRole === ROLES.ALUMNO) {
      const alumno = await Alumno.findOne({ where: { usuarioId: req.userId } });
      if (!alumno) return res.status(403).send({ message: "No tienes un perfil de alumno asociado." });
      where.alumnoId = alumno.id;
    } else if (req.userRole === ROLES.PADRE) {
      const vinculos = await PadreAlumno.findAll({ where: { usuarioId: req.userId } });
      const alumnoIds = vinculos.map(v => v.alumnoId);
      if (alumnoIds.length === 0) return res.send([]);
      // RN-08: solo puede ver las notas de sus hijos asociados
      where.alumnoId = req.query.alumnoId && alumnoIds.includes(Number(req.query.alumnoId))
        ? req.query.alumnoId
        : alumnoIds;
    }

    const notas = await Nota.findAll({
      where,
      include: [
        { model: Alumno, as: "alumno" },
        { model: Curso, as: "curso" },
        { model: Catedratico, as: "catedratico" }
      ]
    });
    res.send(notas);
  } catch (error) {
    res.status(500).send({ message: "Error al obtener las notas." });
  }
};

exports.findOne = async (req, res) => {
  try {
    const nota = await Nota.findByPk(req.params.id, {
      include: [
        { model: Alumno, as: "alumno" },
        { model: Curso, as: "curso" },
        { model: Catedratico, as: "catedratico" }
      ]
    });
    if (!nota) {
      return res.status(404).send({ message: `No se encontró la nota con id=${req.params.id}.` });
    }

    // Verificación de visibilidad (RN-08 y equivalentes)
    if (req.userRole === ROLES.CATEDRATICO) {
      const catedratico = await Catedratico.findOne({ where: { usuarioId: req.userId } });
      if (!catedratico || catedratico.id !== nota.catedraticoId) {
        return res.status(403).send({ message: "No tienes acceso a esta nota." });
      }
    } else if (req.userRole === ROLES.ALUMNO) {
      const alumno = await Alumno.findOne({ where: { usuarioId: req.userId } });
      if (!alumno || alumno.id !== nota.alumnoId) {
        return res.status(403).send({ message: "No tienes acceso a esta nota." });
      }
    } else if (req.userRole === ROLES.PADRE) {
      const vinculo = await PadreAlumno.findOne({ where: { usuarioId: req.userId, alumnoId: nota.alumnoId } });
      if (!vinculo) {
        return res.status(403).send({ message: "No tienes acceso a esta nota." });
      }
    }

    res.send(nota);
  } catch (error) {
    res.status(500).send({ message: "Error al obtener la nota." });
  }
};

// RN-05 — Solo el catedrático responsable puede actualizar la nota que registró.
exports.update = async (req, res) => {
  try {
    const nota = await Nota.findByPk(req.params.id);
    if (!nota) {
      return res.status(404).send({ message: `No se encontró la nota con id=${req.params.id}.` });
    }

    if (req.userRole === ROLES.CATEDRATICO) {
      const catedratico = await Catedratico.findOne({ where: { usuarioId: req.userId } });
      if (!catedratico || catedratico.id !== nota.catedraticoId) {
        return res.status(403).send({ message: "Solo el catedrático responsable puede modificar esta nota." });
      }
    }

    if (req.body.valor !== undefined && (req.body.valor < 0 || req.body.valor > 100)) {
      return res.status(400).send({ message: "El valor de la nota debe estar entre 0 y 100." });
    }

    nota.valor = req.body.valor !== undefined ? req.body.valor : nota.valor;
    await nota.save(); // dispara el hook beforeValidate que recalcula "estado"

    res.send({ message: "Nota actualizada exitosamente.", nota });
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al actualizar la nota." });
  }
};

// Solo el Administrador puede eliminar notas (validado también en la ruta).
exports.delete = async (req, res) => {
  try {
    const nota = await Nota.findByPk(req.params.id);
    if (!nota) {
      return res.status(404).send({ message: `No se encontró la nota con id=${req.params.id}.` });
    }

    await nota.destroy();
    res.send({ message: "Nota eliminada exitosamente." });
  } catch (error) {
    res.status(500).send({ message: "Error al eliminar la nota." });
  }
};


