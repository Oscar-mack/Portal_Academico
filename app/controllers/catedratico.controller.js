const db = require("../models");
const Catedratico = db.catedraticos;

// RF-01 — Gestión de catedráticos (CRUD completo, solo Administrador)
exports.create = async (req, res) => {
  try {
    if (!req.body.nombre || !req.body.apellido || !req.body.email) {
      return res.status(400).send({ message: "nombre, apellido y email son requeridos." });
    }
    const catedratico = await Catedratico.create({
      nombre: req.body.nombre,
      apellido: req.body.apellido,
      email: req.body.email,
      telefono: req.body.telefono,
      especialidad: req.body.especialidad
    });
    res.send(catedratico);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al crear el catedrático." });
  }
};

exports.findAll = async (req, res) => {
  try {
    const catedraticos = await Catedratico.findAll();
    res.send(catedraticos);
  } catch (error) {
    res.status(500).send({ message: "Error al obtener los catedráticos." });
  }
};

exports.findOne = async (req, res) => {
  try {
    const catedratico = await Catedratico.findByPk(req.params.id);
    if (!catedratico) {
      return res.status(404).send({ message: `No se encontró el catedrático con id=${req.params.id}.` });
    }
    res.send(catedratico);
  } catch (error) {
    res.status(500).send({ message: "Error al obtener el catedrático." });
  }
};

exports.update = async (req, res) => {
  try {
    const [num] = await Catedratico.update(req.body, { where: { id: req.params.id } });
    if (num === 1) {
      res.send({ message: "Catedrático actualizado exitosamente." });
    } else {
      res.status(404).send({ message: `No se pudo actualizar el catedrático con id=${req.params.id}.` });
    }
  } catch (error) {
    res.status(500).send({ message: "Error al actualizar el catedrático." });
  }
};

exports.delete = async (req, res) => {
  try {
    const num = await Catedratico.destroy({ where: { id: req.params.id } });
    if (num === 1) {
      res.send({ message: "Catedrático eliminado exitosamente." });
    } else {
      res.status(404).send({ message: `No se pudo eliminar el catedrático con id=${req.params.id}.` });
    }
  } catch (error) {
    res.status(500).send({ message: "Error al eliminar el catedrático." });
  }
};
