const db = require("../models");
const ROLES = require("../config/roles.js");

const PadreAlumno = db.padresAlumnos;
const Usuario = db.usuarios;
const Alumno = db.alumnos;

// Enlaza a un usuario con rol padre con uno o varios alumnos (RN-08).
exports.create = async (req, res) => {
  try {
    const { usuarioId, alumnoId, parentesco } = req.body;
    if (!usuarioId || !alumnoId) {
      return res.status(400).send({ message: "usuarioId y alumnoId son requeridos." });
    }

    const usuario = await Usuario.findByPk(usuarioId);
    if (!usuario || usuario.rol !== ROLES.PADRE) {
      return res.status(400).send({ message: "El usuarioId indicado no existe o no tiene rol padre." });
    }

    const alumno = await Alumno.findByPk(alumnoId);
    if (!alumno) {
      return res.status(404).send({ message: "El alumno indicado no existe." });
    }

    const vinculo = await PadreAlumno.create({ usuarioId, alumnoId, parentesco });
    res.status(201).send(vinculo);
  } catch (error) {
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(409).send({ message: "Ese padre ya está vinculado a este alumno." });
    }
    res.status(500).send({ message: error.message || "Error al crear el vínculo padre-alumno." });
  }
};

exports.findAll = async (req, res) => {
  try {
    const where = {};
    if (req.query.usuarioId) where.usuarioId = req.query.usuarioId;
    if (req.query.alumnoId) where.alumnoId = req.query.alumnoId;

    const vinculos = await PadreAlumno.findAll({
      where,
      include: [{ model: Alumno, as: "alumno" }]
    });
    res.send(vinculos);
  } catch (error) {
    res.status(500).send({ message: "Error al obtener los vínculos padre-alumno." });
  }
};

exports.delete = async (req, res) => {
  try {
    const num = await PadreAlumno.destroy({ where: { id: req.params.id } });
    if (num === 1) {
      res.send({ message: "Vínculo eliminado exitosamente." });
    } else {
      res.status(404).send({ message: `No se encontró el vínculo con id=${req.params.id}.` });
    }
  } catch (error) {
    res.status(500).send({ message: "Error al eliminar el vínculo padre-alumno." });
  }
};
