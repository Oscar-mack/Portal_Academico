const db = require("../models");

const CicloAcademico = db.ciclosAcademicos;
const PeriodoAcademico = db.periodosAcademicos;

exports.findAll = async (req, res) => {
  try {
    const ciclos = await CicloAcademico.findAll({
      include: [{ model: PeriodoAcademico, as: "periodos" }],
      order: [["fechaInicio", "DESC"]]
    });
    res.send(ciclos);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al consultar ciclos académicos." });
  }
};

exports.create = async (req, res) => {
  try {
    const { nombre, fechaInicio, fechaFin } = req.body;
    if (!nombre || !fechaInicio || !fechaFin) {
      return res.status(400).send({ message: "nombre, fechaInicio y fechaFin son requeridos." });
    }
    const ciclo = await CicloAcademico.create({ nombre, fechaInicio, fechaFin });
    res.status(201).send(ciclo);
  } catch (error) {
    const status = error.name === "SequelizeUniqueConstraintError" ? 409 : 400;
    res.status(status).send({ message: error.message || "Error al crear el ciclo académico." });
  }
};

exports.update = async (req, res) => {
  try {
    const ciclo = await CicloAcademico.findByPk(req.params.id);
    if (!ciclo) return res.status(404).send({ message: "Ciclo académico no encontrado." });

    const values = {};
    for (const field of ["nombre", "fechaInicio", "fechaFin", "estado"]) {
      if (req.body[field] !== undefined) values[field] = req.body[field];
    }
    if (values.fechaInicio || values.fechaFin) {
      const periodosFueraDeRango = await PeriodoAcademico.count({
        where: {
          cicloAcademicoId: ciclo.id,
          ...(values.fechaInicio ? { fechaInicio: { [db.Sequelize.Op.lt]: values.fechaInicio } } : {}),
          ...(values.fechaFin ? { fechaFin: { [db.Sequelize.Op.gt]: values.fechaFin } } : {})
        }
      });
      if (periodosFueraDeRango > 0) {
        return res.status(409).send({ message: "Las nuevas fechas del ciclo no pueden excluir períodos existentes." });
      }
    }
    if (values.estado === "cerrado") {
      const periodosAbiertos = await PeriodoAcademico.count({
        where: { cicloAcademicoId: ciclo.id, estado: "abierto" }
      });
      if (periodosAbiertos > 0) {
        return res.status(409).send({ message: "Cierra todos los períodos del ciclo antes de cerrarlo." });
      }
    }
    await ciclo.update(values);
    res.send(ciclo);
  } catch (error) {
    res.status(400).send({ message: error.message || "Error al actualizar el ciclo académico." });
  }
};
