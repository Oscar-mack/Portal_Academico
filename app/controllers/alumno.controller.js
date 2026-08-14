const db = require("../models");
const Alumno = db.alumnos;
const GradoCarrera = db.gradosCarreras;
const Curso = db.cursos;
const Nota = db.notas;

// RF-03 — Gestión de alumnos (RN-01: un alumno debe estar asociado a un grado/carrera)
exports.create = async (req, res) => {
  try {
    const { nombre, apellido, email, telefono, gradoCarreraId } = req.body;
    if (!nombre || !apellido || !email || !gradoCarreraId) {
      return res.status(400).send({ message: "nombre, apellido, email y gradoCarreraId son requeridos." });
    }

    const grado = await GradoCarrera.findByPk(gradoCarreraId);
    if (!grado) {
      return res.status(404).send({ message: "El grado/carrera indicado no existe." });
    }

    const alumno = await Alumno.create({ nombre, apellido, email, telefono, gradoCarreraId });
    res.send(alumno);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al crear el alumno." });
  }
};

exports.findAll = async (req, res) => {
  try {
    // Permite filtrar por grado/carrera: GET /api/alumnos?gradoCarreraId=1
    const where = {};
    if (req.query.gradoCarreraId) where.gradoCarreraId = req.query.gradoCarreraId;

    const alumnos = await Alumno.findAll({
      where,
      include: [{ model: GradoCarrera, as: "gradoCarrera" }]
    });
    res.send(alumnos);
  } catch (error) {
    res.status(500).send({ message: "Error al obtener los alumnos." });
  }
};

exports.findOne = async (req, res) => {
  try {
    const alumno = await Alumno.findByPk(req.params.id, {
      include: [
        { model: GradoCarrera, as: "gradoCarrera" },
        { model: Curso, as: "cursos" }
      ]
    });
    if (!alumno) {
      return res.status(404).send({ message: `No se encontró el alumno con id=${req.params.id}.` });
    }
    res.send(alumno);
  } catch (error) {
    res.status(500).send({ message: "Error al obtener el alumno." });
  }
};

exports.update = async (req, res) => {
  try {
    const [num] = await Alumno.update(req.body, { where: { id: req.params.id } });
    if (num === 1) {
      res.send({ message: "Alumno actualizado exitosamente." });
    } else {
      res.status(404).send({ message: `No se pudo actualizar el alumno con id=${req.params.id}.` });
    }
  } catch (error) {
    res.status(500).send({ message: "Error al actualizar el alumno." });
  }
};

exports.delete = async (req, res) => {
  try {
    const num = await Alumno.destroy({ where: { id: req.params.id } });
    if (num === 1) {
      res.send({ message: "Alumno eliminado exitosamente." });
    } else {
      res.status(404).send({ message: `No se pudo eliminar el alumno con id=${req.params.id}.` });
    }
  } catch (error) {
    res.status(500).send({ message: "Error al eliminar el alumno." });
  }
};

