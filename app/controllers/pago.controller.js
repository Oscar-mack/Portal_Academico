const Stripe = require("stripe");
const db = require("../models");
const ROLES = require("../config/roles.js");
const { calculateCheckoutAmount } = require("../utils/checkoutAmount.js");

const Pago = db.pagos;
const Alumno = db.alumnos;
const PadreAlumno = db.padresAlumnos;
const Cargo = db.cargos;
const EventoStripe = db.eventosStripe;

const SUCCESS_URL = process.env.APP_URL
  ? `${process.env.APP_URL}/pago-exitoso`
  : "http://localhost:5173/pago-exitoso";
const CANCEL_URL = process.env.APP_URL
  ? `${process.env.APP_URL}/pago-cancelado`
  : "http://localhost:5173/pago-cancelado";

let stripeFactory = key => Stripe(key);

const getStripe = () => {
  if (!process.env.STRIPE_SECRET_KEY) {
    const error = new Error("Los pagos en línea no están disponibles porque el proveedor de pagos no está configurado.");
    error.code = "PAYMENT_PROVIDER_UNAVAILABLE";
    throw error;
  }
  return stripeFactory(process.env.STRIPE_SECRET_KEY);
};

// C2: Transiciones validas de estado de pago.
// Un pago 'pagado' es terminal: ningun webhook puede revertirlo.
const TRANSICIONES_VALIDAS = {
  pendiente: ["pagado", "fallido", "cancelado"],
  fallido: [],
  cancelado: [],
  pagado: []  // terminal: webhooks tardios o repetidos no lo degradan
};

const aCentavos = valor => Math.round(Number(valor) * 100);
const desdeCentavos = valor => Number((valor / 100).toFixed(2));

async function obtenerPagoPermitido(req, cargo, transaction) {
  if (req.userRole === ROLES.PADRE) {
    const vinculo = await PadreAlumno.findOne({
      where: { usuarioId: req.userId, alumnoId: cargo.alumnoId },
      transaction
    });
    return Boolean(vinculo);
  }
  if (req.userRole === ROLES.ALUMNO) {
    const alumno = await Alumno.findOne({ where: { usuarioId: req.userId }, transaction });
    return Boolean(alumno && alumno.id === cargo.alumnoId);
  }
  return false;
}

async function saldoCargoEnCentavos(cargoId, transaction) {
  const cargo = await Cargo.findByPk(cargoId, {
    transaction,
    lock: transaction.LOCK.UPDATE
  });
  if (!cargo) return { error: "Cargo no encontrado.", status: 404 };
  const pagos = await Pago.findAll({
    where: { cargoId: cargo.id, estado: "pagado" },
    attributes: ["monto"],
    transaction
  });
  const pagado = pagos.reduce((suma, pago) => suma + aCentavos(pago.monto), 0);
  return { cargo, pagado, saldo: Math.max(0, aCentavos(cargo.montoOriginal) - pagado) };
}

async function crearSesionParaCargo(req, res) {
  const { cargoId, monto: montoSolicitado } = req.body;
  if (!Number.isInteger(Number(cargoId)) || Number(cargoId) <= 0) {
    return res.status(400).send({ message: "cargoId debe ser un identificador válido." });
  }

  const transaction = await db.sequelize.transaction();
  let pago;
  let stripe;
  let reutilizarSesionId = null;
  let cargoNombre;
  let cantidadCentavos;
  try {
    const saldoInfo = await saldoCargoEnCentavos(Number(cargoId), transaction);
    if (saldoInfo.error) {
      await transaction.rollback();
      return res.status(saldoInfo.status).send({ message: saldoInfo.error });
    }
    const { cargo, saldo } = saldoInfo;
    if (!(await obtenerPagoPermitido(req, cargo, transaction))) {
      await transaction.rollback();
      return res.status(403).send({ message: "No puedes pagar un cargo que no pertenece a un alumno autorizado." });
    }
    if (cargo.anuladoEn) {
      await transaction.rollback();
      return res.status(409).send({ message: "El cargo está anulado y no puede pagarse." });
    }
    if (saldo <= 0) {
      await transaction.rollback();
      return res.status(409).send({ message: "El cargo ya está pagado." });
    }

    cantidadCentavos = calculateCheckoutAmount(saldo, montoSolicitado);
    if (cantidadCentavos === null) {
      await transaction.rollback();
      return res.status(400).send({ message: "El abono debe ser positivo, en centavos y no superar el saldo pendiente." });
    }

    try {
      stripe = getStripe();
    } catch (error) {
      await transaction.rollback();
      if (error.code === "PAYMENT_PROVIDER_UNAVAILABLE") {
        return res.status(503).send({ message: error.message });
      }
      throw error;
    }

    const alumno = await Alumno.findByPk(cargo.alumnoId, { transaction });
    cargoNombre = `${cargo.concepto} - ${alumno.nombre} ${alumno.apellido}`;
    pago = await Pago.findOne({
      where: { cargoId: cargo.id, estado: "pendiente" },
      order: [["createdAt", "DESC"]],
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (pago) {
      if (aCentavos(pago.monto) !== cantidadCentavos) {
        await transaction.rollback();
        return res.status(409).send({
          message: "Ya existe un Checkout pendiente para este cargo con un importe diferente."
        });
      }
      reutilizarSesionId = pago.stripeSessionId;
    } else {
      pago = await Pago.create({
        alumnoId: cargo.alumnoId,
        cargoId: cargo.id,
        concepto: cargo.concepto,
        monto: desdeCentavos(cantidadCentavos).toFixed(2),
        moneda: cargo.moneda.toLowerCase(),
        estado: "pendiente",
        metodoPago: "stripe"
      }, { transaction });
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }

  if (reutilizarSesionId) {
    const sesion = await stripe.checkout.sessions.retrieve(reutilizarSesionId);
    if (sesion.status === "open") {
      return res.send({
        pagoId: pago.id,
        sessionId: sesion.id,
        url: sesion.url,
        reutilizado: true
      });
    }
    if (sesion.status === "complete") {
      return res.status(409).send({ message: "El pago está en proceso de confirmación por Stripe.", pagoId: pago.id });
    }
    await pago.update({ estado: "cancelado" });
    return res.status(409).send({ message: "La sesión de pago expiró; vuelve a solicitar el Checkout." });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [{
        price_data: {
          currency: pago.moneda,
          product_data: { name: cargoNombre },
          unit_amount: cantidadCentavos
        },
        quantity: 1
      }],
      success_url: SUCCESS_URL,
      cancel_url: CANCEL_URL,
      metadata: { pagoId: String(pago.id), cargoId: String(cargoId) }
    }, { idempotencyKey: `portal-pago-${pago.id}` });
    await pago.update({ stripeSessionId: session.id });
    return res.send({ pagoId: pago.id, sessionId: session.id, url: session.url });
  } catch (stripeError) {
    console.error("Error al crear sesión Stripe para cargo:", stripeError.message, "pagoId:", pago.id);
    return res.status(502).send({
      message: "No se pudo crear la sesión de pago. Puedes reintentar sin generar un cargo duplicado.",
      pagoId: pago.id
    });
  }
}

// RF-13 — Pagos de colegiatura u otros servicios (Alumno o Padre/Tutor del alumno)
// C1: El pago local se crea ANTES de llamar a Stripe. Si Stripe falla, el pago queda
//     en 'pendiente' sin stripeSessionId. En el reintento se detecta y se reutiliza.
// C4: Idempotencia de negocio — si ya existe un pago pendiente con sesion activa para
//     el mismo alumno y concepto, se reutiliza en lugar de crear uno nuevo.
exports.crearSesion = async (req, res) => {
  try {
    if (req.body.cargoId === undefined) {
      return res.status(400).send({ message: "cargoId es obligatorio; el importe se obtiene del cargo en el servidor." });
    }
    return await crearSesionParaCargo(req, res);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al crear la sesión de pago." });
  }
};

// Webhook de Stripe: confirma el pago cuando el checkout se completa.
// C2: Solo se aplican transiciones validas; 'pagado' es terminal.
// C3: Eventos desconocidos se registran para conciliacion sin fallar.
// C5: Mismatch de monto/sesion se registra y responde 200 para evitar reintentos infinitos.
exports.webhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const tiposRelevantes = new Set([
    "checkout.session.completed",
    "checkout.session.expired",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed"
  ]);
  let duplicate = false;
  try {
    await db.sequelize.transaction(async transaction => {
      const existente = await EventoStripe.findOne({
        where: { stripeEventId: event.id },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (existente) {
        duplicate = true;
        return;
      }

      const session = event.data?.object;
      const pagoId = tiposRelevantes.has(event.type)
        ? session?.metadata?.pagoId
        : null;
      let pago = null;
      if (pagoId) {
        const pagoSnapshot = await Pago.findByPk(pagoId, { transaction });
        if (pagoSnapshot?.cargoId) {
          await Cargo.findByPk(pagoSnapshot.cargoId, {
            transaction,
            lock: transaction.LOCK.UPDATE
          });
        }
        pago = await Pago.findByPk(pagoId, { transaction, lock: transaction.LOCK.UPDATE });
        if (!pago) {
          console.error("Webhook: pago no encontrado", { eventId: event.id, pagoId });
        } else {
          const cargoIdMetadata = session.metadata?.cargoId;
          if (pago.cargoId && String(pago.cargoId) !== String(cargoIdMetadata)) {
            console.error("Webhook: el cargo de metadata no coincide", { eventId: event.id, pagoId });
            pago = null;
          } else if (pago.stripeSessionId && pago.stripeSessionId !== session.id) {
            console.error("Webhook: sesión Stripe no coincide", {
              eventId: event.id, pagoId, expected: pago.stripeSessionId, received: session.id
            });
            pago = null;
          } else {
            let estadoNuevo = null;
            if (
              (event.type === "checkout.session.completed" && session.payment_status === "paid") ||
              event.type === "checkout.session.async_payment_succeeded"
            ) {
              estadoNuevo = "pagado";
            } else if (event.type === "checkout.session.expired") {
              estadoNuevo = "cancelado";
            } else if (event.type === "checkout.session.async_payment_failed") {
              estadoNuevo = "fallido";
            }

            if (estadoNuevo === "pagado" && pago.cargoId && session.amount_total !== null &&
                session.amount_total !== undefined &&
                Number(session.amount_total) !== aCentavos(pago.monto)) {
              console.error("Webhook: monto Stripe no coincide con el pago", {
                eventId: event.id, pagoId, expected: aCentavos(pago.monto), received: session.amount_total
              });
              estadoNuevo = null;
            }
            if (estadoNuevo === "pagado" && pago.cargoId && session.currency &&
                session.currency.toLowerCase() !== pago.moneda.toLowerCase()) {
              console.error("Webhook: moneda Stripe no coincide con el pago", { eventId: event.id, pagoId });
              estadoNuevo = null;
            }

            if (estadoNuevo && (TRANSICIONES_VALIDAS[pago.estado] || []).includes(estadoNuevo)) {
              const paymentIntentId = typeof session.payment_intent === "string"
                ? session.payment_intent
                : session.payment_intent?.id;
              await pago.update({
                estado: estadoNuevo,
                ...(!pago.stripeSessionId ? { stripeSessionId: session.id } : {}),
                ...(estadoNuevo === "pagado" ? { fechaPago: new Date() } : {}),
                ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {})
              }, { transaction });
            }
          }
        }
      }

      await EventoStripe.create({
        stripeEventId: event.id,
        tipo: event.type,
        pagoId: pago?.id || null,
        procesadoEn: new Date()
      }, { transaction });
    });
  } catch (error) {
    if (error.name === "SequelizeUniqueConstraintError") {
      const yaProcesado = await EventoStripe.findOne({ where: { stripeEventId: event.id } });
      if (yaProcesado) return res.json({ received: true, duplicate: true });
    }
    console.error("Error al procesar el webhook de pago:", error.message);
    return res.status(500).send({ message: "Error al procesar el evento." });
  }
  res.json({ received: true, ...(duplicate ? { duplicate: true } : {}) });
};

// Consulta de pagos (Administrador ve todos; Alumno/Padre ven solo lo suyo)
exports.findAll = async (req, res) => {
  try {
    const where = {};

    if (req.userRole === ROLES.ALUMNO) {
      const alumno = await Alumno.findOne({ where: { usuarioId: req.userId } });
      if (!alumno) return res.send([]);
      if (req.query.alumnoId && alumno.id !== Number(req.query.alumnoId)) {
        return res.status(403).send({ message: "Solo puedes consultar tus propios pagos." });
      }
      where.alumnoId = alumno.id;
    } else if (req.userRole === ROLES.PADRE) {
      const vinculos = await PadreAlumno.findAll({ where: { usuarioId: req.userId } });
      const alumnoIds = vinculos.map(v => v.alumnoId);
      if (req.query.alumnoId && !alumnoIds.includes(Number(req.query.alumnoId))) {
        return res.status(403).send({ message: "No tienes acceso a los pagos de este alumno." });
      }
      where.alumnoId = req.query.alumnoId ? Number(req.query.alumnoId) : alumnoIds;
    } else if (req.userRole === ROLES.ADMIN && req.query.alumnoId) {
      where.alumnoId = req.query.alumnoId;
    }

    if (req.query.estado) where.estado = req.query.estado;
    if (req.query.cargoId) where.cargoId = req.query.cargoId;
    const pagos = await Pago.findAll({
      where,
      include: [{ model: Alumno, as: "alumno" }, { model: Cargo, as: "cargo" }],
      order: [["createdAt", "DESC"]]
    });
    res.send(pagos);
  } catch (error) {
    res.status(500).send({ message: "Error al obtener los pagos." });
  }
};

exports._testing = {
  setStripeFactory(factory) {
    stripeFactory = factory;
  },
  resetStripeFactory() {
    stripeFactory = key => Stripe(key);
  }
};
