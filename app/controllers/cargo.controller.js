const db = require("../models");
const ROLES = require("../config/roles.js");

const Cargo = db.cargos;
const Pago = db.pagos;
const Alumno = db.alumnos;
const PadreAlumno = db.padresAlumnos;

const cents = value => Math.round(Number(value) * 100);
const fromCents = value => Number((value / 100).toFixed(2));

async function obtenerAlumnosPermitidos(req, alumnoId) {
  if (req.userRole === ROLES.ADMIN) return alumnoId ? [Number(alumnoId)] : null;
  if (req.userRole === ROLES.ALUMNO) {
    const alumno = await Alumno.findOne({ where: { usuarioId: req.userId } });
    if (!alumno || (alumnoId && alumno.id !== Number(alumnoId))) return { forbidden: true };
    return [alumno.id];
  }
  if (req.userRole === ROLES.PADRE) {
    const vinculos = await PadreAlumno.findAll({ where: { usuarioId: req.userId } });
    const alumnoIds = vinculos.map(vinculo => vinculo.alumnoId);
    if (alumnoId && !alumnoIds.includes(Number(alumnoId))) return { forbidden: true };
    return alumnoId ? [Number(alumnoId)] : alumnoIds;
  }
  return { forbidden: true };
}

async function incluirSaldos(cargos) {
  if (cargos.length === 0) return [];
  const cargoIds = cargos.map(cargo => cargo.id);
  const pagos = await Pago.findAll({
    where: { cargoId: cargoIds },
    order: [["createdAt", "ASC"]]
  });
  const pagosPorCargo = new Map();
  for (const pago of pagos) {
    const lista = pagosPorCargo.get(pago.cargoId) || [];
    lista.push(pago);
    pagosPorCargo.set(pago.cargoId, lista);
  }
  const hoy = new Date().toISOString().slice(0, 10);
  return cargos.map(cargo => {
    const pagosCargo = pagosPorCargo.get(cargo.id) || [];
    const pagado = pagosCargo
      .filter(pago => pago.estado === "pagado")
      .reduce((total, pago) => total + cents(pago.monto), 0);
    const saldo = Math.max(0, cents(cargo.montoOriginal) - pagado);
    let estado;
    if (cargo.anuladoEn) estado = "anulado";
    else if (saldo === 0) estado = "pagado";
    else if (pagado > 0) estado = "parcial";
    else if (cargo.fechaVencimiento && cargo.fechaVencimiento < hoy) estado = "vencido";
    else estado = "pendiente";
    return {
      ...cargo.toJSON(),
      montoPagado: fromCents(pagado),
      saldoPendiente: fromCents(saldo),
      estado,
      pagos: pagosCargo
    };
  });
}

async function obtenerPagosHistoricosNoAsociados(alumnoId) {
  const pagos = await Pago.findAll({
    where: {
      alumnoId,
      cargoId: null,
      estado: ["pendiente", "pagado"]
    },
    attributes: ["id", "concepto", "monto", "moneda", "estado", "fechaPago", "createdAt"],
    order: [["createdAt", "ASC"]]
  });
  const resumen = new Map();
  for (const pago of pagos) {
    const moneda = String(pago.moneda || "GTQ").toUpperCase();
    const importe = resumen.get(moneda) || { cantidad: 0, montoPagado: 0, montoPendiente: 0 };
    importe.cantidad += 1;
    if (pago.estado === "pagado") importe.montoPagado += cents(pago.monto);
    else importe.montoPendiente += cents(pago.monto);
    resumen.set(moneda, importe);
  }
  return {
    pagos,
    resumen: Object.fromEntries([...resumen].map(([moneda, importes]) => [
      moneda,
      {
        cantidad: importes.cantidad,
        montoPagado: fromCents(importes.montoPagado),
        montoPendiente: fromCents(importes.montoPendiente)
      }
    ]))
  };
}

exports.create = async (req, res) => {
  try {
    const { alumnoId, concepto, descripcion, montoOriginal, moneda, fechaEmision, fechaVencimiento,
      cicloAcademicoId, periodoAcademicoId } = req.body;
    if (!alumnoId || !concepto || !Number.isFinite(Number(montoOriginal)) ||
        Number(montoOriginal) <= 0) {
      return res.status(400).send({ message: "alumnoId, concepto y montoOriginal positivo son requeridos." });
    }
    if (cents(montoOriginal) < 1 || Math.abs(Number(montoOriginal) * 100 - cents(montoOriginal)) > 1e-7) {
      return res.status(400).send({ message: "El monto debe expresarse en centavos exactos." });
    }
    const monedaCargo = (moneda || "GTQ").toUpperCase();
    if (!["GTQ", "USD"].includes(monedaCargo)) {
      return res.status(400).send({ message: "La moneda debe ser GTQ o USD." });
    }
    const alumno = await Alumno.findByPk(alumnoId);
    if (!alumno || !alumno.activo) return res.status(404).send({ message: "El alumno no existe o está inactivo." });
    let cicloAcademicoIdEfectivo = cicloAcademicoId || null;
    if (periodoAcademicoId) {
      const periodo = await db.periodosAcademicos.findByPk(periodoAcademicoId);
      if (!periodo) return res.status(404).send({ message: "El período académico no existe." });
      if (cicloAcademicoIdEfectivo && Number(cicloAcademicoIdEfectivo) !== periodo.cicloAcademicoId) {
        return res.status(400).send({ message: "El período no pertenece al ciclo académico indicado." });
      }
      cicloAcademicoIdEfectivo = periodo.cicloAcademicoId;
    } else if (cicloAcademicoIdEfectivo) {
      const ciclo = await db.ciclosAcademicos.findByPk(cicloAcademicoIdEfectivo);
      if (!ciclo) return res.status(404).send({ message: "El ciclo académico no existe." });
    }
    const cargo = await Cargo.create({
      alumnoId,
      concepto,
      descripcion,
      montoOriginal: Number(montoOriginal).toFixed(2),
      moneda: monedaCargo,
      fechaEmision: fechaEmision || new Date().toISOString().slice(0, 10),
      fechaVencimiento: fechaVencimiento || null,
      cicloAcademicoId: cicloAcademicoIdEfectivo,
      periodoAcademicoId: periodoAcademicoId || null
    });
    res.status(201).send({ ...cargo.toJSON(), montoPagado: 0, saldoPendiente: Number(cargo.montoOriginal), estado: "pendiente", pagos: [] });
  } catch (error) {
    res.status(400).send({ message: error.message || "Error al crear el cargo." });
  }
};

exports.findAll = async (req, res) => {
  try {
    const permitidos = await obtenerAlumnosPermitidos(req, req.query.alumnoId);
    if (permitidos?.forbidden) return res.status(403).send({ message: "No tienes acceso a los cargos de este alumno." });
    const where = {};
    if (permitidos) where.alumnoId = permitidos;
    if (req.query.cicloAcademicoId) where.cicloAcademicoId = req.query.cicloAcademicoId;
    if (req.query.periodoAcademicoId) where.periodoAcademicoId = req.query.periodoAcademicoId;
    if (req.query.incluirAnulados !== "true") where.anuladoEn = null;
    const cargos = await Cargo.findAll({
      where,
      include: [{ model: Alumno, as: "alumno" }],
      order: [["fechaEmision", "DESC"], ["id", "DESC"]]
    });
    let resultado = await incluirSaldos(cargos);
    if (req.query.estado) resultado = resultado.filter(cargo => cargo.estado === req.query.estado);
    res.send(resultado);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al consultar cargos." });
  }
};

exports.solvencia = async (req, res) => {
  try {
    const permitidos = await obtenerAlumnosPermitidos(req, req.query.alumnoId);
    if (permitidos?.forbidden) return res.status(403).send({ message: "No tienes acceso a la solvencia de este alumno." });
    if (!permitidos || permitidos.length !== 1) {
      return res.status(400).send({ message: "Indica un alumno autorizado para consultar su solvencia." });
    }
    const alumnoId = permitidos[0];
    const cargos = await Cargo.findAll({ where: { alumnoId, anuladoEn: null } });
    const conSaldos = await incluirSaldos(cargos);
    const historico = await obtenerPagosHistoricosNoAsociados(alumnoId);
    const saldoPorMoneda = new Map();
    for (const cargo of conSaldos) {
      saldoPorMoneda.set(
        cargo.moneda,
        (saldoPorMoneda.get(cargo.moneda) || 0) + cents(cargo.saldoPendiente)
      );
    }
    const saldos = Object.fromEntries([...saldoPorMoneda].map(([moneda, saldo]) => [
      moneda,
      fromCents(saldo)
    ]));
    const saldoTotalUnicaMoneda = saldoPorMoneda.size > 1
      ? null
      : fromCents(saldoPorMoneda.values().next().value || 0);
    res.send({
      alumnoId,
      solvente: historico.pagos.length === 0 &&
        [...saldoPorMoneda.values()].every(saldo => saldo === 0),
      conciliacionHistoricaRequerida: historico.pagos.length > 0,
      pagosHistoricosSinCargo: historico.resumen,
      saldoPendiente: saldoTotalUnicaMoneda,
      saldoPendientePorMoneda: saldos,
      cargosPendientes: conSaldos.filter(cargo => cargo.saldoPendiente > 0)
    });
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al calcular la solvencia." });
  }
};

exports.update = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const cargo = await Cargo.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!cargo) {
      await transaction.rollback();
      return res.status(404).send({ message: "Cargo no encontrado." });
    }
    const pagos = await Pago.findAll({ where: { cargoId: cargo.id }, transaction });
    if (pagos.some(pago => ["pendiente", "pagado"].includes(pago.estado))) {
      await transaction.rollback();
      return res.status(409).send({ message: "No se puede editar un cargo con pagos pendientes o confirmados." });
    }
    const values = {};
    for (const field of ["concepto", "descripcion", "fechaVencimiento"]) {
      if (req.body[field] !== undefined) values[field] = req.body[field];
    }
    if (req.body.montoOriginal !== undefined) {
      const amount = Number(req.body.montoOriginal);
      if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - cents(amount)) > 1e-7) {
        await transaction.rollback();
        return res.status(400).send({ message: "montoOriginal debe ser positivo y expresarse en centavos." });
      }
      values.montoOriginal = amount.toFixed(2);
    }
    await cargo.update(values, { transaction });
    await transaction.commit();
    res.send(cargo);
  } catch (error) {
    await transaction.rollback();
    res.status(400).send({ message: error.message || "Error al actualizar el cargo." });
  }
};

exports.cancel = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const cargo = await Cargo.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!cargo) {
      await transaction.rollback();
      return res.status(404).send({ message: "Cargo no encontrado." });
    }
    if (cargo.anuladoEn) {
      await transaction.rollback();
      return res.status(409).send({ message: "El cargo ya está anulado." });
    }
    const pagos = await Pago.findAll({ where: { cargoId: cargo.id }, transaction });
    if (pagos.some(pago => ["pendiente", "pagado"].includes(pago.estado))) {
      await transaction.rollback();
      return res.status(409).send({ message: "No se puede anular un cargo con pagos pendientes o confirmados." });
    }
    if (!req.body.motivo || !String(req.body.motivo).trim()) {
      await transaction.rollback();
      return res.status(400).send({ message: "El motivo de anulación es obligatorio." });
    }
    await cargo.update({
      anuladoEn: new Date(),
      anuladoPorId: req.userId,
      motivoAnulacion: String(req.body.motivo).trim()
    }, { transaction });
    await transaction.commit();
    res.send({ message: "Cargo anulado.", id: cargo.id, anuladoEn: cargo.anuladoEn });
  } catch (error) {
    await transaction.rollback();
    res.status(500).send({ message: error.message || "Error al anular el cargo." });
  }
};

exports.incluirSaldos = incluirSaldos;
exports.obtenerPagosHistoricosNoAsociados = obtenerPagosHistoricosNoAsociados;
exports._testing = { cents, incluirSaldos, obtenerPagosHistoricosNoAsociados };
