const db = require("../models");
const ROLES = require("../config/roles.js");
const { Op } = require("sequelize");
const { validarNotaCompleta } = require("./evaluacion.controller.js");

const Nota = db.notas;
const AuditoriaNota = db.auditoriaNotas;
const Alumno = db.alumnos;
const Curso = db.cursos;
const Catedratico = db.catedraticos;
const AsignacionCurso = db.asignacionesCurso;
const HorarioCatedratico = db.horariosCatedratico;
const PadreAlumno = db.padresAlumnos;

// B3: El umbral viene del modelo para que haya una sola fuente de verdad.
// Si la institucion cambia la regla, solo se edita nota.model.js.
const NOTA_MINIMA_APROBACION = Nota.NOTA_MINIMA_APROBACION;

// RF-07 — Registro de notas.
// RN-05 — Solo el catedratico responsable de un curso podra registrar sus calificaciones.
// B4: Toda la operacion se ejecuta dentro de una transaccion para serializar frente
//     a cambios concurrentes de inscripcion o asignacion de docente.
exports.create = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const { alumnoId, cursoId, valor, periodo } = req.body;
    if (!alumnoId || !cursoId || valor === undefined) {
      await t.rollback();
      return res.status(400).send({ message: "alumnoId, cursoId y valor son requeridos." });
    }
    if (typeof valor !== "number" || !Number.isFinite(valor) || valor < 0 || valor > 100) {
      await t.rollback();
      return res.status(400).send({ message: "El valor de la nota debe ser un numero entre 0 y 100." });
    }

    let catedraticoId;
    if (req.userRole === ROLES.ADMIN) {
      catedraticoId = req.body.catedraticoId;
      if (!catedraticoId) {
        await t.rollback();
        return res.status(400).send({ message: "Como administrador, debes indicar catedraticoId." });
      }
    } else {
      const catedratico = await Catedratico.findOne({ where: { usuarioId: req.userId }, transaction: t });
      if (!catedratico) {
        await t.rollback();
        return res.status(403).send({ message: "Tu usuario no tiene un perfil de catedratico asociado." });
      }
      catedraticoId = catedratico.id;
    }

    // RN-05: validar dentro de la transaccion que el catedratico imparte ese curso.
    const responsable = await HorarioCatedratico.findOne({ where: { catedraticoId, cursoId }, transaction: t });
    if (!responsable) {
      await t.rollback();
      return res.status(403).send({
        message: "Este catedratico no tiene asignado el curso indicado; no puede registrar notas en el."
      });
    }

    // Validar que el alumno este inscrito en el curso.
    const inscripcion = await AsignacionCurso.findOne({
      where: { alumnoId, cursoId, periodo: periodo || "2026" },
      transaction: t
    });
    if (!inscripcion) {
      await t.rollback();
      return res.status(400).send({ message: "El alumno no esta inscrito en este curso." });
    }

    const nota = await Nota.create(
      { alumnoId, cursoId, catedraticoId, valor, periodo: periodo || "2026" },
      { transaction: t }
    );
    await t.commit();
    res.send(nota);
  } catch (error) {
    await t.rollback();
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(409).send({ message: "Ya existe una nota registrada para este alumno en este curso y periodo. Usa actualizar." });
    }
    res.status(500).send({ message: error.message || "Error al registrar la nota." });
  }
};

// RF-08 — Consulta de notas, con visibilidad restringida por rol.
// B1: Alumnos y tutores solo ven notas publicadas (publicadaEn IS NOT NULL).
//     Admin y catedratico ven todas (publicadas y no publicadas).
exports.findAll = async (req, res) => {
  try {
    const where = {};
    if (req.query.cursoId) where.cursoId = req.query.cursoId;
    if (req.query.periodo) where.periodo = req.query.periodo;
    if (req.query.periodoAcademicoId) where.periodoAcademicoId = req.query.periodoAcademicoId;

    if (req.userRole === ROLES.ADMIN) {
      if (req.query.alumnoId) where.alumnoId = req.query.alumnoId;
      if (req.query.catedraticoId) where.catedraticoId = req.query.catedraticoId;
      // Admin ve todas: publicadas y no publicadas.
    } else if (req.userRole === ROLES.CATEDRATICO) {
      const catedratico = await Catedratico.findOne({ where: { usuarioId: req.userId } });
      if (!catedratico) return res.status(403).send({ message: "No tienes un perfil de catedratico asociado." });
      where.catedraticoId = catedratico.id;
      // Catedratico ve todas sus notas: publicadas y no publicadas.
    } else if (req.userRole === ROLES.ALUMNO) {
      const alumno = await Alumno.findOne({ where: { usuarioId: req.userId } });
      if (!alumno) return res.status(403).send({ message: "No tienes un perfil de alumno asociado." });
      where.alumnoId = alumno.id;
      // B1: Alumno solo ve notas publicadas.
      where.publicadaEn = { [Op.ne]: null };
    } else if (req.userRole === ROLES.PADRE) {
      const vinculos = await PadreAlumno.findAll({ where: { usuarioId: req.userId } });
      const alumnoIds = vinculos.map(v => v.alumnoId);
      if (req.query.alumnoId && !alumnoIds.includes(Number(req.query.alumnoId))) {
        return res.status(403).send({ message: "No tienes acceso a las notas de este alumno." });
      }
      if (alumnoIds.length === 0) return res.send([]);
      // RN-08: solo puede ver las notas de sus hijos asociados.
      where.alumnoId = req.query.alumnoId ? Number(req.query.alumnoId) : alumnoIds;
      // B1: Tutor solo ve notas publicadas.
      where.publicadaEn = { [Op.ne]: null };
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
      return res.status(404).send({ message: `No se encontro la nota con id=${req.params.id}.` });
    }

    // Verificacion de visibilidad por rol.
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
      // B1: Alumno solo ve nota si esta publicada.
      if (!nota.publicadaEn) {
        return res.status(403).send({ message: "Esta nota aun no ha sido publicada." });
      }
    } else if (req.userRole === ROLES.PADRE) {
      const vinculo = await PadreAlumno.findOne({ where: { usuarioId: req.userId, alumnoId: nota.alumnoId } });
      if (!vinculo) {
        return res.status(403).send({ message: "No tienes acceso a esta nota." });
      }
      // B1: Tutor solo ve nota si esta publicada.
      if (!nota.publicadaEn) {
        return res.status(403).send({ message: "Esta nota aun no ha sido publicada." });
      }
    }

    res.send(nota);
  } catch (error) {
    res.status(500).send({ message: "Error al obtener la nota." });
  }
};

exports.historial = async (req, res) => {
  try {
    const nota = await Nota.findByPk(req.params.id);
    if (!nota) return res.status(404).send({ message: "Nota no encontrada." });
    if (req.userRole === ROLES.CATEDRATICO) {
      const catedratico = await Catedratico.findOne({ where: { usuarioId: req.userId } });
      if (!catedratico || catedratico.id !== nota.catedraticoId) {
        return res.status(403).send({ message: "No tienes acceso al historial de esta nota." });
      }
    } else if (req.userRole !== ROLES.ADMIN) {
      return res.status(403).send({ message: "El historial de cambios solo está disponible para administración y el catedrático responsable." });
    }
    const historial = await AuditoriaNota.findAll({
      where: { notaId: nota.id },
      order: [["createdAt", "ASC"]]
    });
    res.send(historial);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al consultar el historial de la nota." });
  }
};

// RN-05 — Solo el catedratico responsable puede actualizar la nota que registro.
// B2: Todos los checks (acceso, rango) se re-verifican dentro de la transaccion con lock
//     para evitar condiciones de carrera entre un update y un cierre concurrente.
exports.update = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    // Leer con lock ANTES de cualquier comprobacion de estado.
    const nota = await Nota.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!nota) {
      await t.rollback();
      return res.status(404).send({ message: `No se encontro la nota con id=${req.params.id}.` });
    }

    // Verificar autorizacion dentro del lock.
    if (req.userRole === ROLES.CATEDRATICO) {
      const catedratico = await Catedratico.findOne({ where: { usuarioId: req.userId }, transaction: t });
      if (!catedratico || catedratico.id !== nota.catedraticoId) {
        await t.rollback();
        return res.status(403).send({ message: "Solo el catedratico responsable puede modificar esta nota." });
      }
    }

    const nuevoValor = req.body.valor;
    if (nuevoValor !== undefined && nota.periodoAcademicoId) {
      await t.rollback();
      return res.status(409).send({
        message: "La nota final se calcula desde las evaluaciones; modifica las calificaciones individuales."
      });
    }
    if (nuevoValor !== undefined && (typeof nuevoValor !== "number" || !Number.isFinite(nuevoValor) || nuevoValor < 0 || nuevoValor > 100)) {
      await t.rollback();
      return res.status(400).send({ message: "El valor de la nota debe ser un numero entre 0 y 100." });
    }

    const valorAnterior = Number(nota.valor);
    if (nuevoValor !== undefined && nota.periodoAcademicoId) {
      const periodo = await db.periodosAcademicos.findByPk(nota.periodoAcademicoId, { transaction: t });
      if (periodo.estado !== "abierto" && req.userRole !== ROLES.ADMIN) {
        await t.rollback();
        return res.status(409).send({ message: "El período está cerrado; solo un administrador puede modificar la nota." });
      }
    }
    const motivo = typeof req.body.motivo === "string" ? req.body.motivo.trim() : "";
    if (nuevoValor !== undefined && nuevoValor !== valorAnterior && nota.publicadaEn && motivo.length < 10) {
      await t.rollback();
      return res.status(400).send({
        message: "Modificar una nota publicada requiere un motivo de al menos 10 caracteres."
      });
    }
    if (nuevoValor !== undefined) nota.valor = nuevoValor;
    if (nuevoValor !== undefined && nuevoValor !== valorAnterior) {
      await AuditoriaNota.create({
        notaId: nota.id,
        usuarioId: req.userId,
        valorAnterior,
        valorNuevo: nuevoValor,
        motivo: motivo || null
      }, { transaction: t });
      if (nota.periodoAcademicoId) nota.publicadaEn = null;
    }
    // El hook beforeValidate recalcula nota.estado automaticamente.
    await nota.save({ transaction: t });

    await t.commit();
    res.send({ message: "Nota actualizada exitosamente.", nota });
  } catch (error) {
    await t.rollback();
    res.status(500).send({ message: error.message || "Error al actualizar la nota." });
  }
};

// B5: Publicar nota — hace visible la nota para alumno y tutor.
// Solo el catedratico responsable o el administrador puede publicar.
exports.publish = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const nota = await Nota.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!nota) {
      await t.rollback();
      return res.status(404).send({ message: `No se encontro la nota con id=${req.params.id}.` });
    }

    if (nota.publicadaEn) {
      await t.rollback();
      return res.status(409).send({ message: "La nota ya fue publicada." });
    }

    if (nota.periodoAcademicoId) {
      const periodo = await db.periodosAcademicos.findByPk(nota.periodoAcademicoId, { transaction: t });
      if (periodo.estado !== "abierto" && req.userRole !== ROLES.ADMIN) {
        await t.rollback();
        return res.status(409).send({ message: "El período está cerrado; solo un administrador puede publicar la nota." });
      }
      if (!(await validarNotaCompleta(nota, t))) {
        await t.rollback();
        return res.status(409).send({ message: "No se puede publicar una nota con evaluaciones o calificaciones incompletas." });
      }
    }

    // Solo el catedratico que registro la nota o el admin puede publicarla.
    if (req.userRole === ROLES.CATEDRATICO) {
      const catedratico = await Catedratico.findOne({ where: { usuarioId: req.userId }, transaction: t });
      if (!catedratico || catedratico.id !== nota.catedraticoId) {
        await t.rollback();
        return res.status(403).send({ message: "Solo el catedratico responsable puede publicar esta nota." });
      }
    }

    await nota.update({ publicadaEn: new Date() }, { transaction: t });
    await t.commit();
    res.send({ message: "Nota publicada exitosamente.", id: nota.id, publicadaEn: nota.publicadaEn });
  } catch (error) {
    await t.rollback();
    res.status(500).send({ message: error.message || "Error al publicar la nota." });
  }
};

// Solo el Administrador puede eliminar notas (validado tambien en la ruta).
exports.delete = async (req, res) => {
  try {
    const nota = await Nota.findByPk(req.params.id);
    if (!nota) {
      return res.status(404).send({ message: `No se encontro la nota con id=${req.params.id}.` });
    }
    if (nota.periodoAcademicoId || nota.publicadaEn ||
        await AuditoriaNota.count({ where: { notaId: nota.id } }) > 0) {
      return res.status(409).send({ message: "La nota tiene historial o pertenece a un período académico y no puede eliminarse." });
    }
    await nota.destroy();
    res.send({ message: "Nota eliminada exitosamente." });
  } catch (error) {
    res.status(500).send({ message: "Error al eliminar la nota." });
  }
};
