const crypto = require("crypto");
const Stripe = require("stripe");
const db = require("../models");
const ROLES = require("../config/roles.js");
const { calculateCheckoutAmount } = require("../utils/checkoutAmount.js");

const Pago = db.pagos;
const Alumno = db.alumnos;
const PadreAlumno = db.padresAlumnos;
const Cargo = db.cargos;
const EventoStripe = db.eventosStripe;

function checkoutReturnUrl(path) {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  return new URL(path, `${frontendUrl.replace(/\/+$/, "")}/`).toString();
}

// Stripe sustituye {CHECKOUT_SESSION_ID}; por eso la cadena se arma a mano y no con URLSearchParams.
function checkoutReturnUrls(pagoId) {
  return {
    success: `${checkoutReturnUrl("/pago-exitoso")}?pago_id=${pagoId}&session_id={CHECKOUT_SESSION_ID}`,
    cancel: `${checkoutReturnUrl("/pago-cancelado")}?pago_id=${pagoId}`
  };
}

const returnTarget = value => {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
};

let stripeFactory = key => Stripe(key);

const PROVIDER_UNAVAILABLE = "PAYMENT_PROVIDER_UNAVAILABLE";

// El webhook solo necesita las claves de Stripe; FRONTEND_URL únicamente se usa al crear el Checkout.
// Exigirla en el webhook haría que Stripe reciba 400 y los pagos nunca se confirmen.
const getStripe = ({ checkout = false } = {}) => {
  const required = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"];
  if (checkout && process.env.NODE_ENV === "production") required.push("FRONTEND_URL");
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    const error = new Error(
      `Los pagos en línea no están disponibles; faltan variables de configuración: ${missing.join(", ")}.`
    );
    error.code = PROVIDER_UNAVAILABLE;
    throw error;
  }
  if (checkout) {
    try {
      checkoutReturnUrl("/pago-exitoso");
    } catch {
      const error = new Error("Los pagos en línea no están disponibles; FRONTEND_URL no es una URL válida.");
      error.code = PROVIDER_UNAVAILABLE;
      throw error;
    }
  }
  return stripeFactory(process.env.STRIPE_SECRET_KEY);
};

// C2: Transiciones validas de estado de pago.
// Un pago 'pagado' es terminal: ningun webhook puede revertirlo.
const TRANSICIONES_VALIDAS = {
  pendiente: ["pagado", "fallido", "cancelado"],
  fallido: [],
  cancelado: [],
  anulado: [],
  pagado: []  // terminal para webhooks: solo un administrador puede anularlo (anularPago)
};

const aCentavos = valor => Math.round(Number(valor) * 100);
const desdeCentavos = valor => Number((valor / 100).toFixed(2));
const ESTADOS_REEMBOLSO_FALLIDO = new Set(["failed", "canceled"]);
const idPaymentIntent = valor => typeof valor === "string" ? valor : valor?.id || null;

function reembolsoCoincide(pago, refund) {
  return Boolean(pago.stripePaymentIntentId) &&
    idPaymentIntent(refund.payment_intent) === pago.stripePaymentIntentId &&
    Number.isSafeInteger(Number(refund.amount)) &&
    Number(refund.amount) === aCentavos(pago.monto) &&
    typeof refund.currency === "string" &&
    refund.currency.toLowerCase() === String(pago.moneda).toLowerCase();
}

async function listarReembolsos(stripe, filtros) {
  const refunds = [];
  const cursores = new Set();
  let startingAfter;

  do {
    const page = await stripe.refunds.list({
      ...filtros,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {})
    });
    refunds.push(...page.data);
    if (!page.has_more) break;

    const lastId = page.data.at(-1)?.id;
    if (!lastId || cursores.has(lastId)) {
      throw new Error("Stripe devolvió una página de reembolsos sin cursor válido.");
    }
    cursores.add(lastId);
    startingAfter = lastId;
  } while (true);

  return refunds;
}

async function metadataAnulacion(refund, pago, transaction) {
  const metadata = refund.metadata || {};
  const idAutorizado = async value => {
    const userId = typeof value === "number"
      ? value
      : typeof value === "string" && /^[1-9]\d*$/.test(value)
        ? Number(value)
        : NaN;
    if (!Number.isSafeInteger(userId) || userId <= 0) return null;
    const usuario = await db.usuarios.findByPk(userId, { transaction });
    return usuario?.rol === ROLES.ADMIN ? usuario.id : null;
  };
  const usuarioId = await idAutorizado(metadata.anuladoPorId) ||
    await idAutorizado(pago.anuladoPorId);
  const metadataMotivo = typeof metadata.motivo === "string" ? metadata.motivo.trim() : "";
  const motivoExistente = typeof pago.motivoAnulacion === "string" ? pago.motivoAnulacion.trim() : "";

  return {
    estado: "anulado",
    anuladoEn: new Date(),
    anuladoPorId: usuarioId,
    motivoAnulacion: metadataMotivo.length >= 5
      ? metadataMotivo
      : motivoExistente.length >= 5
        ? motivoExistente
        : `Reembolso confirmado por Stripe${refund.id ? ` (${refund.id})` : ""}`,
    ...(refund.id ? { stripeRefundId: refund.id } : {})
  };
}

async function conciliarReembolso({ eventId, refund, transaction }) {
  const paymentIntentId = idPaymentIntent(refund.payment_intent);
  if (!paymentIntentId) {
    console.error("Webhook: reembolso sin PaymentIntent; requiere revisión", { eventId, refundId: refund.id });
    return null;
  }

  const snapshot = await Pago.findOne({
    where: { stripePaymentIntentId: paymentIntentId },
    transaction
  });
  if (!snapshot) {
    console.error("Webhook: reembolso sin pago local relacionado; requiere revisión", {
      eventId, refundId: refund.id, paymentIntentId
    });
    return null;
  }
  if (snapshot.cargoId) {
    await Cargo.findByPk(snapshot.cargoId, { transaction, lock: transaction.LOCK.UPDATE });
  }
  const pago = await Pago.findByPk(snapshot.id, { transaction, lock: transaction.LOCK.UPDATE });
  if (!pago) return null;

  const metadataPagoId = refund.metadata?.pagoId;
  if (metadataPagoId !== undefined && String(metadataPagoId) !== String(pago.id)) {
    console.error("Webhook: el pagoId del reembolso no coincide con el PaymentIntent; requiere revisión", {
      eventId, refundId: refund.id, pagoId: pago.id
    });
    return null;
  }
  if (!reembolsoCoincide(pago, refund)) {
    console.error("Webhook: importe, moneda o PaymentIntent del reembolso no coinciden; requiere revisión", {
      eventId, refundId: refund.id, pagoId: pago.id
    });
    return pago;
  }

  if (refund.status === "succeeded") {
    if (pago.estado === "pagado") {
      await pago.update(await metadataAnulacion(refund, pago, transaction), { transaction });
    } else if (pago.estado === "anulado" && !pago.stripeRefundId && refund.id) {
      await pago.update({ stripeRefundId: refund.id }, { transaction });
    } else if (pago.estado !== "anulado") {
      console.error("Webhook: reembolso exitoso para un pago que no está pagado; requiere revisión", {
        eventId, refundId: refund.id, pagoId: pago.id, estado: pago.estado
      });
    }
  } else if (ESTADOS_REEMBOLSO_FALLIDO.has(refund.status) &&
      pago.estado === "pagado" && pago.stripeRefundId === refund.id) {
    await pago.update({
      stripeRefundId: null,
      anuladoEn: null,
      anuladoPorId: null,
      motivoAnulacion: null
    }, { transaction });
  } else if (ESTADOS_REEMBOLSO_FALLIDO.has(refund.status) &&
      pago.estado === "anulado" && pago.stripeRefundId === refund.id) {
    console.error("Webhook: reembolso ya aplicado aparece fallido; requiere conciliación manual", {
      eventId, refundId: refund.id, pagoId: pago.id
    });
  }
  return pago;
}

// Intenta expirar una sesión abierta. Devuelve "expired", "complete" (el webhook confirmará el cobro)
// o "error" si Stripe no respondió y no se pudo comprobar el estado.
async function expirarSesion(stripe, sessionId) {
  try {
    await stripe.checkout.sessions.expire(sessionId);
    return "expired";
  } catch {
    const sesion = await stripe.checkout.sessions.retrieve(sessionId).catch(() => null);
    if (sesion?.status === "expired") return "expired";
    if (sesion?.status === "complete") return "complete";
    return "error";
  }
}

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
      stripe = getStripe({ checkout: true });
    } catch (error) {
      await transaction.rollback();
      if (error.code === PROVIDER_UNAVAILABLE) {
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
        if (pago.stripeSessionId) {
          await transaction.rollback();
          return res.status(409).send({
            message: "Ya existe un Checkout pendiente para este cargo con un importe diferente. Cancélalo desde Pagos para elegir otro importe.",
            pagoId: pago.id
          });
        }
        // Sin sesión en Stripe no hay nada que conciliar: se ajusta el importe del intento fallido anterior.
        await pago.update({ monto: desdeCentavos(cantidadCentavos).toFixed(2) }, { transaction });
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
    if (!transaction.finished) await transaction.rollback();
    throw error;
  }

  if (reutilizarSesionId) {
    let sesion = null;
    try {
      sesion = await stripe.checkout.sessions.retrieve(reutilizarSesionId);
    } catch (stripeError) {
      console.error("Error al consultar sesión Stripe:", stripeError.message, "pagoId:", pago.id);
    }
    if (!sesion) {
      return res.status(502).send({ message: "No se pudo comunicar con Stripe. Intenta nuevamente en unos momentos.", pagoId: pago.id });
    }
    if (sesion.status === "open") {
      // Una sesión creada con otra FRONTEND_URL devolvería al usuario a una página inexistente.
      if (returnTarget(sesion.success_url) === returnTarget(checkoutReturnUrls(pago.id).success)) {
        return res.send({
          pagoId: pago.id,
          sessionId: sesion.id,
          url: sesion.url,
          reutilizado: true
        });
      }
      const cierre = await expirarSesion(stripe, sesion.id);
      if (cierre === "error") {
        return res.status(502).send({ message: "No se pudo comunicar con Stripe. Intenta nuevamente en unos momentos.", pagoId: pago.id });
      }
      if (cierre === "complete") {
        return res.status(409).send({ message: "El pago está en proceso de confirmación por Stripe.", pagoId: pago.id });
      }
    } else if (sesion.status === "complete") {
      return res.status(409).send({ message: "El pago está en proceso de confirmación por Stripe.", pagoId: pago.id });
    }
    await pago.update({ estado: "cancelado" });
    // La sesión anterior expiró: se genera un Checkout nuevo en lugar de pedir al usuario que reintente.
    return crearSesionParaCargo(req, res);
  }

  const returnUrls = checkoutReturnUrls(pago.id);
  const sessionParams = {
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
    success_url: returnUrls.success,
    cancel_url: returnUrls.cancel,
    metadata: { pagoId: String(pago.id), cargoId: String(pago.cargoId) }
  };
  // Stripe rechaza reutilizar una clave con parámetros distintos; el hash la hace válida tras cambios de importe o URL.
  const paramsHash = crypto.createHash("sha256").update(JSON.stringify(sessionParams)).digest("hex").slice(0, 16);
  try {
    const session = await stripe.checkout.sessions.create(sessionParams, {
      idempotencyKey: `portal-pago-${pago.id}-${paramsHash}`
    });
    await pago.update({ stripeSessionId: session.id });
    return res.send({ pagoId: pago.id, sessionId: session.id, url: session.url });
  } catch (stripeError) {
    console.error("Error al crear sesión Stripe para cargo:", stripeError.type, stripeError.code, stripeError.message, "pagoId:", pago.id);
    const reintentable = !stripeError.type || ["StripeConnectionError", "StripeAPIError", "StripeRateLimitError"].includes(stripeError.type);
    if (!reintentable) {
      // Stripe rechazó la solicitud: no existe sesión, se libera el cargo para que el usuario pueda reintentar.
      await pago.update({ estado: "cancelado" }).catch(() => {});
    }
    if (stripeError.code === "amount_too_small") {
      return res.status(400).send({ message: "El importe es menor al mínimo que Stripe permite cobrar en esta moneda." });
    }
    if (["StripeAuthenticationError", "StripePermissionError"].includes(stripeError.type)) {
      return res.status(503).send({ message: "Los pagos en línea no están disponibles; revisa la clave STRIPE_SECRET_KEY." });
    }
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
    console.error("Error al iniciar el checkout:", error.message);
    res.status(500).send({ message: "No se pudo iniciar el pago por un error interno. Intenta nuevamente." });
  }
};

// Webhook de Stripe: confirma el pago cuando el checkout se completa.
// C2: Solo se aplican transiciones validas; 'pagado' es terminal.
// C3: Eventos desconocidos se registran para conciliacion sin fallar.
// C5: Mismatch de monto/sesion se registra y responde 200 para evitar reintentos infinitos.
exports.webhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  let stripe;

  try {
    stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    if (err.code === PROVIDER_UNAVAILABLE) {
      console.error("Configuración de Stripe incompleta para el webhook:", err.message);
      return res.status(503).send({ message: "El procesamiento de pagos no está configurado temporalmente." });
    }
    return res.status(400).send({ message: "Webhook Error: firma inválida." });
  }

  const tiposRelevantes = new Set([
    "checkout.session.completed",
    "checkout.session.expired",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed"
  ]);
  const tiposReembolso = new Set([
    "refund.created",
    "refund.updated",
    "refund.failed",
    "charge.refund.updated",
    "charge.refunded"
  ]);
  const esEventoReembolso = tiposReembolso.has(event.type);
  let refundsDelCharge = [];

  if (event.type === "charge.refunded") {
    const charge = event.data?.object;
    const paymentIntentId = idPaymentIntent(charge?.payment_intent);
    const filtros = paymentIntentId
      ? { payment_intent: paymentIntentId }
      : charge?.id
        ? { charge: charge.id }
        : null;
    if (!filtros) {
      console.error("Webhook: charge.refunded sin identificador de cobro; requiere revisión", {
        eventId: event.id
      });
    } else {
      try {
        refundsDelCharge = await listarReembolsos(stripe, filtros);
      } catch (error) {
        console.error("Webhook: no se pudieron consultar los reembolsos del cobro:", error.message);
        return res.status(500).send({ message: "Error al procesar el evento." });
      }
    }
  }

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

      if (esEventoReembolso) {
        let pagoRelacionado = null;
        if (event.type === "charge.refunded") {
          const exitosos = refundsDelCharge.filter(refund => refund.status === "succeeded");
          for (const refund of exitosos) {
            pagoRelacionado = (await conciliarReembolso({
              eventId: event.id,
              refund,
              transaction
            })) || pagoRelacionado;
          }
          if (!exitosos.length) {
            console.error("Webhook: charge.refunded sin reembolsos exitosos consultables; requiere revisión", {
              eventId: event.id
            });
          }
        } else if (event.data?.object) {
          pagoRelacionado = await conciliarReembolso({
            eventId: event.id,
            refund: event.data.object,
            transaction
          });
        }
        await EventoStripe.create({
          stripeEventId: event.id,
          tipo: event.type,
          pagoId: pagoRelacionado?.id || null,
          procesadoEn: new Date()
        }, { transaction });
        return;
      }

      const session = event.data?.object;
      const pagoId = tiposRelevantes.has(event.type) ? session?.metadata?.pagoId : null;
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

            if (estadoNuevo === "pagado" && pago.cargoId) {
              const amountMatches = Number.isSafeInteger(Number(session.amount_total)) &&
                Number(session.amount_total) === aCentavos(pago.monto);
              const currencyMatches = typeof session.currency === "string" &&
                session.currency.toLowerCase() === pago.moneda.toLowerCase();
              if (!amountMatches) {
                console.error("Webhook: monto Stripe no coincide con el pago", {
                  eventId: event.id, pagoId, expected: aCentavos(pago.monto), received: session.amount_total
                });
                estadoNuevo = null;
              } else if (!currencyMatches) {
                console.error("Webhook: moneda Stripe no coincide con el pago", { eventId: event.id, pagoId });
                estadoNuevo = null;
              }
            }

            if (estadoNuevo === "pagado" && !(TRANSICIONES_VALIDAS[pago.estado] || []).includes(estadoNuevo)) {
              console.error("Webhook: cobro confirmado para un pago que no está pendiente; requiere conciliación manual", {
                eventId: event.id, pagoId, estadoActual: pago.estado
              });
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

// El alumno o padre autorizado puede abandonar su Checkout pendiente (p. ej. tras volver desde Stripe
// con "cancelar") para liberar el cargo y poder pagar otro importe sin esperar la expiración de Stripe.
exports.cancelarCheckout = async (req, res) => {
  const pagoId = Number(req.params.id);
  if (!Number.isInteger(pagoId) || pagoId <= 0) {
    return res.status(400).send({ message: "El identificador del pago no es válido." });
  }
  const transaction = await db.sequelize.transaction();
  try {
    const snapshot = await Pago.findByPk(pagoId, { transaction });
    if (!snapshot) {
      await transaction.rollback();
      return res.status(404).send({ message: "Pago no encontrado." });
    }
    if (!(await obtenerPagoPermitido(req, snapshot, transaction))) {
      await transaction.rollback();
      return res.status(403).send({ message: "No puedes cancelar un pago que no pertenece a un alumno autorizado." });
    }
    if (snapshot.cargoId) {
      await Cargo.findByPk(snapshot.cargoId, { transaction, lock: transaction.LOCK.UPDATE });
    }
    const pago = await Pago.findByPk(pagoId, { transaction, lock: transaction.LOCK.UPDATE });
    if (pago.estado !== "pendiente") {
      await transaction.rollback();
      return res.status(409).send({
        message: pago.estado === "pagado"
          ? "El pago ya fue confirmado y no puede cancelarse."
          : `El pago ya está en estado '${pago.estado}'.`,
        estado: pago.estado
      });
    }
    if (pago.stripeSessionId) {
      let stripe;
      try {
        stripe = getStripe();
      } catch (error) {
        await transaction.rollback();
        if (error.code === PROVIDER_UNAVAILABLE) return res.status(503).send({ message: error.message });
        throw error;
      }
      const cierre = await expirarSesion(stripe, pago.stripeSessionId);
      if (cierre === "complete") {
        await transaction.rollback();
        return res.status(409).send({
          message: "El pago se está confirmando en Stripe y no puede cancelarse. Verifica el estado en unos segundos."
        });
      }
      if (cierre === "error") {
        await transaction.rollback();
        return res.status(502).send({ message: "No se pudo comunicar con Stripe para cancelar el Checkout. Intenta nuevamente." });
      }
    }
    await pago.update({ estado: "cancelado" }, { transaction });
    await transaction.commit();
    return res.send({ id: pago.id, estado: "cancelado", message: "El Checkout pendiente fue cancelado." });
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    console.error("Error al cancelar el Checkout:", error.message);
    return res.status(500).send({ message: "No se pudo cancelar el Checkout." });
  }
};

async function obtenerOCrearReembolso(stripe, pago, usuarioId, motivo) {
  let refunds;
  try {
    refunds = await listarReembolsos(stripe, { payment_intent: pago.stripePaymentIntentId });
  } catch (error) {
    console.error("Error al consultar reembolsos en Stripe:", error.message, "pagoId:", pago.id);
    return {
      error: {
        status: 502,
        message: "No se pudieron consultar los reembolsos en Stripe; el pago no fue modificado."
      }
    };
  }

  const fallidos = refunds.filter(refund => ESTADOS_REEMBOLSO_FALLIDO.has(refund.status)).length;
  const activos = refunds.filter(refund => !ESTADOS_REEMBOLSO_FALLIDO.has(refund.status));
  if (activos.length > 1 || (activos.length === 1 && !reembolsoCoincide(pago, activos[0]))) {
    return {
      error: {
        status: 409,
        message: "El cobro tiene reembolsos parciales o múltiples en Stripe. El portal solo admite reembolsos completos; requiere conciliación manual."
      }
    };
  }
  if (activos.length === 1) return { refund: activos[0] };

  try {
    const refund = await stripe.refunds.create({
      payment_intent: pago.stripePaymentIntentId,
      amount: aCentavos(pago.monto),
      metadata: {
        pagoId: String(pago.id),
        anuladoPorId: String(usuarioId),
        motivo: motivo.slice(0, 400)
      }
    }, { idempotencyKey: `portal-reembolso-${pago.id}-${fallidos}` });
    if (ESTADOS_REEMBOLSO_FALLIDO.has(refund.status)) {
      return {
        error: {
          status: 502,
          message: "Stripe no pudo procesar el reembolso; el pago permanece confirmado."
        }
      };
    }
    if (!reembolsoCoincide(pago, refund)) {
      console.error("Stripe devolvió un reembolso inconsistente:", refund.id, "pagoId:", pago.id);
      return {
        error: {
          status: 502,
          message: "Stripe devolvió un reembolso inconsistente; el pago no fue modificado. Requiere revisión."
        }
      };
    }
    return { refund };
  } catch (error) {
    console.error("Error al crear reembolso en Stripe:", error.message, "pagoId:", pago.id);
    return {
      error: {
        status: 502,
        message: "Stripe no pudo procesar el reembolso; el pago no fue modificado."
      }
    };
  }
}

// Los pagos nunca se eliminan: forman parte del rastro contable. Un administrador solo puede
// - cancelar un Checkout 'pendiente' (se expira la sesión en Stripe), o
// - anular un pago 'pagado' (reversión contable: deja de contar en el saldo y conserva el registro).
// Para devolver el dinero al pagador se debe indicar reembolsar=true (Refund en Stripe).
exports.anular = async (req, res) => {
  const motivo = String(req.body?.motivo ?? "").trim();
  if (motivo.length < 5) {
    return res.status(400).send({ message: "El motivo de anulación es obligatorio (mínimo 5 caracteres)." });
  }
  if (req.body?.reembolsar !== undefined && typeof req.body.reembolsar !== "boolean") {
    return res.status(400).send({ message: "reembolsar debe ser verdadero o falso." });
  }
  const reembolsar = req.body?.reembolsar === true;
  const pagoId = Number(req.params.id);
  if (!Number.isInteger(pagoId) || pagoId <= 0) {
    return res.status(400).send({ message: "El identificador del pago no es válido." });
  }

  const transaction = await db.sequelize.transaction();
  let refundRemoto = null;
  try {
    // Mismo orden de bloqueo que el webhook: primero el cargo y luego el pago.
    const snapshot = await Pago.findByPk(pagoId, { transaction });
    if (!snapshot) {
      await transaction.rollback();
      return res.status(404).send({ message: "Pago no encontrado." });
    }
    if (snapshot.cargoId) {
      await Cargo.findByPk(snapshot.cargoId, { transaction, lock: transaction.LOCK.UPDATE });
    }
    const pago = await Pago.findByPk(pagoId, { transaction, lock: transaction.LOCK.UPDATE });

    if (!["pendiente", "pagado"].includes(pago.estado)) {
      await transaction.rollback();
      return res.status(409).send({ message: `El pago ya está en estado '${pago.estado}' y no puede anularse.` });
    }
    if (pago.estado === "pendiente" && reembolsar) {
      await transaction.rollback();
      return res.status(400).send({ message: "Un pago pendiente no tiene cobro que reembolsar." });
    }

    let stripe = null;
    if (pago.estado === "pendiente" ? Boolean(pago.stripeSessionId) : reembolsar) {
      try {
        stripe = getStripe();
      } catch (error) {
        await transaction.rollback();
        if (error.code === PROVIDER_UNAVAILABLE) return res.status(503).send({ message: error.message });
        throw error;
      }
    }

    const cambios = {};
    let reembolsoId = null;
    if (pago.estado === "pendiente") {
      if (stripe) {
        try {
          await stripe.checkout.sessions.expire(pago.stripeSessionId);
        } catch (stripeError) {
          // Si la sesión ya se completó, el webhook confirmará el pago; no se puede cancelar.
          const sesion = await stripe.checkout.sessions.retrieve(pago.stripeSessionId).catch(() => null);
          if (sesion?.status !== "expired") {
            await transaction.rollback();
            return res.status(409).send({
              message: "No se pudo cancelar la sesión en Stripe; puede estar completándose. Verifica el estado e inténtalo de nuevo."
            });
          }
        }
      }
      Object.assign(cambios, {
        estado: "cancelado",
        anuladoEn: new Date(),
        anuladoPorId: req.userId,
        motivoAnulacion: motivo
      });
    } else {
      if (reembolsar) {
        if (!pago.stripePaymentIntentId) {
          await transaction.rollback();
          return res.status(400).send({ message: "El pago no tiene un cobro de Stripe asociado para reembolsar." });
        }
        const resultado = await obtenerOCrearReembolso(stripe, pago, req.userId, motivo);
        if (resultado.error) {
          await transaction.rollback();
          return res.status(resultado.error.status).send({ message: resultado.error.message });
        }
        refundRemoto = resultado.refund;
        reembolsoId = refundRemoto.id;
        if (refundRemoto.status === "succeeded") {
          Object.assign(cambios, {
            estado: "anulado",
            anuladoEn: new Date(),
            anuladoPorId: req.userId,
            motivoAnulacion: motivo,
            stripeRefundId: reembolsoId
          });
        } else {
          await pago.update({
            stripeRefundId: reembolsoId,
            anuladoPorId: req.userId,
            motivoAnulacion: motivo
          }, { transaction });
          await transaction.commit();
          return res.status(202).send({
            id: pago.id,
            estado: pago.estado,
            reembolsado: false,
            reembolsoEnCurso: true,
            message: "Stripe aún está procesando el reembolso. El pago seguirá como 'pagado' hasta que Stripe lo confirme."
          });
        }
      } else {
        Object.assign(cambios, {
          estado: "anulado",
          anuladoEn: new Date(),
          anuladoPorId: req.userId,
          motivoAnulacion: motivo
        });
      }
    }
    await pago.update(cambios, { transaction });
    await transaction.commit();
    return res.send({
      id: pago.id,
      estado: pago.estado,
      reembolsado: Boolean(reembolsoId),
      reembolsoEnCurso: false,
      message: reembolsoId || pago.estado === "cancelado"
        ? "Pago anulado correctamente."
        : "Pago anulado contablemente. El dinero no se devolvió automáticamente; gestiona el reembolso en Stripe."
    });
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    console.error("Error al anular el pago:", error.message, refundRemoto ? `reembolso Stripe: ${refundRemoto.id}` : "");
    if (refundRemoto) {
      return res.status(500).send({
        message: "El reembolso fue creado en Stripe pero no se pudo guardar en el portal. El webhook intentará conciliarlo automáticamente."
      });
    }
    return res.status(500).send({ message: "No se pudo anular el pago." });
  }
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
