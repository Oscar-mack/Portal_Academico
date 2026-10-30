const db = require("../models");

const Requisito = db.requisitosSolvenciaDocumentos;

exports.findAll = async (req, res) => {
  try {
    const requisitos = await Requisito.findAll({ order: [["tipoDocumento", "ASC"]] });
    res.send(requisitos);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al consultar requisitos de solvencia." });
  }
};

exports.create = async (req, res) => {
  try {
    const tipoDocumento = typeof req.body.tipoDocumento === "string"
      ? req.body.tipoDocumento.trim()
      : "";
    const requiereSolvencia = req.body.requiereSolvencia;
    if (!tipoDocumento || tipoDocumento.length > 80 || typeof requiereSolvencia !== "boolean") {
      return res.status(400).send({
        message: "tipoDocumento (máximo 80 caracteres) y requiereSolvencia booleano son requeridos."
      });
    }
    const requisito = await Requisito.create({ tipoDocumento, requiereSolvencia });
    res.status(201).send(requisito);
  } catch (error) {
    const status = error.name === "SequelizeUniqueConstraintError" ? 409 : 400;
    res.status(status).send({ message: error.message || "Error al crear el requisito de solvencia." });
  }
};

exports.update = async (req, res) => {
  try {
    const requisito = await Requisito.findByPk(req.params.id);
    if (!requisito) return res.status(404).send({ message: "Requisito de solvencia no encontrado." });
    const values = {};
    if (req.body.tipoDocumento !== undefined) {
      if (typeof req.body.tipoDocumento !== "string" ||
          !req.body.tipoDocumento.trim() ||
          req.body.tipoDocumento.trim().length > 80) {
        return res.status(400).send({ message: "tipoDocumento debe contener entre 1 y 80 caracteres." });
      }
      values.tipoDocumento = req.body.tipoDocumento.trim();
    }
    if (req.body.requiereSolvencia !== undefined) {
      if (typeof req.body.requiereSolvencia !== "boolean") {
        return res.status(400).send({ message: "requiereSolvencia debe ser booleano." });
      }
      values.requiereSolvencia = req.body.requiereSolvencia;
    }
    if (Object.keys(values).length === 0) {
      return res.status(400).send({ message: "Indica al menos un campo para actualizar." });
    }
    await requisito.update(values);
    res.send(requisito);
  } catch (error) {
    const status = error.name === "SequelizeUniqueConstraintError" ? 409 : 400;
    res.status(status).send({ message: error.message || "Error al actualizar el requisito de solvencia." });
  }
};
