const db = require("../models");

const CicloAcademico = db.ciclosAcademicos;
const PeriodoAcademico = db.periodosAcademicos;

async function existeTraslape(cicloAcademicoId, fechaInicio, fechaFin, excluirId) {
  const where = {
    cicloAcademicoId,
    fechaInicio: { [db.Sequelize.Op.lte]: fechaFin },
    fechaFin: { [db.Sequelize.Op.gte]: fechaInicio }
  };
  if (excluirId) where.id = { [db.Sequelize.Op.ne]: excluirId };
  return PeriodoAcademico.count({ where });
}

async function validarCicloYFechas(cicloAcademicoId, fechaInicio, fechaFin) {
  const ciclo = await CicloAcademico.findByPk(cicloAcademicoId);
  if (!ciclo) return { error: "El ciclo académico no existe.", status: 404 };
  if (fechaInicio > fechaFin || fechaInicio < ciclo.fechaInicio || fechaFin > ciclo.fechaFin) {
    return { error: "Las fechas del período deben estar dentro del ciclo académico.", status: 400 };
  }
  return { ciclo };
}

exports.findAll = async (req, res) => {
  try {
    const where = {};
    if (req.query.cicloAcademicoId) where.cicloAcademicoId = req.query.cicloAcademicoId;
    if (req.query.estado) where.estado = req.query.estado;
    const periodos = await PeriodoAcademico.findAll({
      where,
      include: [{ model: CicloAcademico, as: "cicloAcademico" }],
      order: [["fechaInicio", "ASC"]]
    });
    res.send(periodos);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al consultar períodos académicos." });
  }
};

exports.create = async (req, res) => {
  try {
    const { cicloAcademicoId, nombre, tipo, fechaInicio, fechaFin } = req.body;
    if (!cicloAcademicoId || !nombre || !tipo || !fechaInicio || !fechaFin) {
      return res.status(400).send({
        message: "cicloAcademicoId, nombre, tipo, fechaInicio y fechaFin son requeridos."
      });
    }
    const validacion = await validarCicloYFechas(cicloAcademicoId, fechaInicio, fechaFin);
    if (validacion.error) return res.status(validacion.status).send({ message: validacion.error });
    if (await existeTraslape(cicloAcademicoId, fechaInicio, fechaFin)) {
      return res.status(409).send({ message: "Las fechas del período se traslapan con otro período del ciclo." });
    }
    if (validacion.ciclo.estado !== "abierto") {
      return res.status(409).send({ message: "No se pueden agregar períodos a un ciclo cerrado." });
    }
    const periodo = await PeriodoAcademico.create({
      cicloAcademicoId, nombre, tipo, fechaInicio, fechaFin
    });
    res.status(201).send(periodo);
  } catch (error) {
    const status = error.name === "SequelizeUniqueConstraintError" ? 409 : 400;
    res.status(status).send({ message: error.message || "Error al crear el período académico." });
  }
};

exports.update = async (req, res) => {
  try {
    const periodo = await PeriodoAcademico.findByPk(req.params.id);
    if (!periodo) return res.status(404).send({ message: "Período académico no encontrado." });
    const values = {};
    for (const field of ["nombre", "tipo", "fechaInicio", "fechaFin", "estado"]) {
      if (req.body[field] !== undefined) values[field] = req.body[field];
    }
    const cicloAcademicoId = periodo.cicloAcademicoId;
    const fechaInicio = values.fechaInicio || periodo.fechaInicio;
    const fechaFin = values.fechaFin || periodo.fechaFin;
    const validacion = await validarCicloYFechas(cicloAcademicoId, fechaInicio, fechaFin);
    if (validacion.error) return res.status(validacion.status).send({ message: validacion.error });
    if (await existeTraslape(cicloAcademicoId, fechaInicio, fechaFin, periodo.id)) {
      return res.status(409).send({ message: "Las fechas del período se traslapan con otro período del ciclo." });
    }
    if (values.estado === "abierto" && validacion.ciclo.estado !== "abierto") {
      return res.status(409).send({ message: "No se puede abrir un período de un ciclo cerrado." });
    }
    await periodo.update(values);
    res.send(periodo);
  } catch (error) {
    const status = error.name === "SequelizeUniqueConstraintError" ? 409 : 400;
    res.status(status).send({ message: error.message || "Error al actualizar el período académico." });
  }
};

module.exports.validarCicloYFechas = validarCicloYFechas;
