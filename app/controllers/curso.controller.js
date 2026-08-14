const db = require("../models");
const Curso = db.cursos;
const GradoCarrera = db.gradosCarreras;

// RF-05 — Gestión de cursos (RN-02: un curso debe pertenecer a un grado/carrera)
exports.create = async (req, res) => {
  try {
    const { nombre, codigo, creditos, gradoCarreraId } = req.body;
    if (!nombre || !codigo || !gradoCarreraId) {
      return res.status(400).send({ message: "nombre, codigo y gradoCarreraId son requeridos." });
    }

    const grado = await GradoCarrera.findByPk(gradoCarreraId);
    if (!grado) {
      return res.status(404).send({ message: "El grado/carrera indicado no existe." });
    }

    const curso = await Curso.create({ nombre, codigo, creditos, gradoCarreraId });
    res.send(curso);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al crear el curso." });
  }
};

exports.findAll = async (req, res) => {
  try {
    const cursos = await Curso.findAll({
      include: [{ model: GradoCarrera, as: "gradoCarrera" }]
    });
    res.send(cursos);
  } catch (error) {
    res.status(500).send({ message: "Error al obtener los cursos." });
  }
};

exports.findOne = async (req, res) => {
  try {
    const curso = await Curso.findByPk(req.params.id, {
      include: [{ model: GradoCarrera, as: "gradoCarrera" }]
    });
    if (!curso) {
      return res.status(404).send({ message: `No se encontró el curso con id=${req.params.id}.` });
    }
    res.send(curso);
  } catch (error) {
    res.status(500).send({ message: "Error al obtener el curso." });
  }
};

exports.update = async (req, res) => {
  try {
    const [num] = await Curso.update(req.body, { where: { id: req.params.id } });
    if (num === 1) {
      res.send({ message: "Curso actualizado exitosamente." });
    } else {
      res.status(404).send({ message: `No se pudo actualizar el curso con id=${req.params.id}.` });
    }
  } catch (error) {
    res.status(500).send({ message: "Error al actualizar el curso." });
  }
};

exports.delete = async (req, res) => {
  try {
    const num = await Curso.destroy({ where: { id: req.params.id } });
    if (num === 1) {
      res.send({ message: "Curso eliminado exitosamente." });
    } else {
      res.status(404).send({ message: `No se pudo eliminar el curso con id=${req.params.id}.` });
    }
  } catch (error) {
    res.status(500).send({ message: "Error al eliminar el curso." });
  }
};

