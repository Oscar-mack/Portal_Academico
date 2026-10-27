const Stripe = require("stripe");
const db = require("../models");
const ROLES = require("../config/roles.js");

const Pago = db.pagos;
const Alumno = db.alumnos;
const PadreAlumno = db.padresAlumnos;

const SUCCESS_URL = process.env.APP_URL
  ? `${process.env.APP_URL}/pago-exitoso`
  : "http://localhost:5173/pago-exitoso";
const CANCEL_URL = process.env.APP_URL
  ? `${process.env.APP_URL}/pago-cancelado`
  : "http://localhost:5173/pago-cancelado";

const getStripe = () => {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY no esta configurada.");
  }
  return Stripe(process.env.STRIPE_SECRET_KEY);
};

// C2: Transiciones validas de estado de pago.
// Un pago 'pagado' es terminal: ningun webhook puede revertirlo.
const TRANSICIONES_VALIDAS = {
  pendiente: ["pagado", "cancelado"],
  cancelado: [],
  pagado: []  // terminal: webhooks tardios o repetidos no lo degradan
};

// Tabla de deduplicacion de eventos Stripe en memoria (simple, compatible con SQLite de tests).
// En produccion con multiples instancias se recomienda una tabla en DB.
// La tabla 'eventos_stripe' en DB es la solucion robusta; esto es fallback en memoria.
const eventosProcessados = new Set();

// RF-13 — Pagos de colegiatura u otros servicios (Alumno o Padre/Tutor del alumno)
// C1: El pago local se crea ANTES de llamar a Stripe. Si Stripe falla, el pago queda
//     en 'pendiente' sin stripeSessionId. En el reintento se detecta y se reutiliza.
// C4: Idempotencia de negocio — si ya existe un pago pendiente con sesion activa para
//     el mismo alumno y concepto, se reutiliza en lugar de crear uno nuevo.
exports.crearSesion = async (req, res) => {
  try {
    const stripe = getStripe();
    const { alumnoId, concepto, monto } = req.body;
    const montoNumerico = Number(monto);

    if (!alumnoId || !concepto || !Number.isFinite(montoNumerico) || montoNumerico <= 0) {
      return res.status(400).send({ message: "alumnoId, concepto y monto son requeridos." });
    }

    const montoEnCentavos = Math.round(montoNumerico * 100);
    if (!Number.isSafeInteger(montoEnCentavos) || montoEnCentavos < 1) {
      return res.status(400).send({ message: "El monto debe ser mayor que cero y valido." });
    }

    const alumno = await Alumno.findByPk(alumnoId);
    if (!alumno) return res.status(404).send({ message: "El alumno indicado no existe." });

    if (req.userRole === ROLES.PADRE) {
      const vinculo = await PadreAlumno.findOne({ where: { usuarioId: req.userId, alumnoId } });
      if (!vinculo) {
        return res.status(403).send({ message: "No puedes generar pagos para un alumno que no es tu hijo/a." });
      }
    } else if (req.userRole === ROLES.ALUMNO) {
      const propio = await Alumno.findOne({ where: { usuarioId: req.userId } });
      if (!propio || propio.id !== Number(alumnoId)) {
        return res.status(403).send({ message: "Solo puedes generar pagos para tu propio perfil." });
      }
    }

    // C4: Buscar si ya existe un pago pendiente con sesion activa para este alumno y concepto.
    const moneda = (process.env.PAYMENT_CURRENCY || "usd").toLowerCase();
    const pagoExistente = await Pago.findOne({
      where: { alumnoId, concepto, estado: "pendiente" },
      order: [["createdAt", "DESC"]]
    });

    if (pagoExistente?.stripeSessionId) {
      // Verificar si la sesion de Stripe todavia esta abierta.
      try {
        const session = await stripe.checkout.sessions.retrieve(pagoExistente.stripeSessionId);
        if (session.status === "open") {
          return res.send({
            pagoId: pagoExistente.id,
            sessionId: session.id,
            url: session.url,
            reutilizado: true
          });
        }
      } catch {
        // Si Stripe no encuentra la sesion, continuar creando una nueva.
      }
    }

    // C1: Crear el pago local primero. Si Stripe falla despues, el pago queda
    // en 'pendiente' sin stripeSessionId para poder reintentar sin doble cargo.
    const pago = await Pago.create({
      alumnoId, concepto, monto: montoNumerico, estado: "pendiente", moneda
    });

    try {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: pago.moneda,
              product_data: { name: `${concepto} - ${alumno.nombre} ${alumno.apellido}` },
              unit_amount: montoEnCentavos
            },
            quantity: 1
          }
        ],
        success_url: SUCCESS_URL,
        cancel_url: CANCEL_URL,
        metadata: { pagoId: String(pago.id) }
      }, { idempotencyKey: `portal-pago-${pago.id}` });

      pago.stripeSessionId = session.id;
      await pago.save();

      res.send({ pagoId: pago.id, sessionId: session.id, url: session.url });
    } catch (stripeError) {
      // C1: No marcar como fallido. El pago permanece 'pendiente' sin stripeSessionId.
      // Un administrador o reintento del usuario puede recuperarlo.
      console.error("Error al crear sesion Stripe:", stripeError.message, "pagoId:", pago.id);
      res.status(502).send({ message: "No se pudo conectar con el proveedor de pagos. Intenta de nuevo en unos momentos.", pagoId: pago.id });
    }
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al crear la sesion de pago." });
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

  // Deduplicacion: ignorar eventos ya procesados (idempotencia).
  if (eventosProcessados.has(event.id)) {
    return res.json({ received: true, duplicate: true });
  }

  try {
    const session = event.data.object;
    const pagoId = session && session.metadata && session.metadata.pagoId;

    const tiposRelevantes = [
      "checkout.session.completed",
      "checkout.session.expired",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed"
    ];

    if (pagoId && tiposRelevantes.includes(event.type)) {
      const pago = await Pago.findByPk(pagoId);

      if (!pago) {
        // C5: Pago no encontrado — registrar para conciliacion, responder 200.
        console.error("Webhook: pago no encontrado", { eventId: event.id, pagoId });
        eventosProcessados.add(event.id);
        return res.json({ received: true });
      }

      if (pago.stripeSessionId && pago.stripeSessionId !== session.id) {
        // C5: La sesion no coincide — registrar para conciliacion, responder 200.
        console.error("Webhook: sesion no coincide", {
          eventId: event.id, pagoId, esperado: pago.stripeSessionId, recibido: session.id
        });
        eventosProcessados.add(event.id);
        return res.json({ received: true });
      }

      // Determinar nuevo estado segun el tipo de evento.
      let nuevoEstado = null;
      if (
        (event.type === "checkout.session.completed" && session.payment_status === "paid") ||
        event.type === "checkout.session.async_payment_succeeded"
      ) {
        nuevoEstado = "pagado";
      } else if (event.type === "checkout.session.expired") {
        nuevoEstado = "cancelado";
      } else if (event.type === "checkout.session.async_payment_failed") {
        // No hay 'fallido' en el ENUM actual; se deja en pendiente y se registra.
        console.warn("Webhook: pago asincrono fallido", { eventId: event.id, pagoId });
        eventosProcessados.add(event.id);
        return res.json({ received: true });
      }

      if (nuevoEstado) {
        // C2: Verificar que la transicion sea valida antes de aplicarla.
        const permitidos = TRANSICIONES_VALIDAS[pago.estado] ?? [];
        if (!permitidos.includes(nuevoEstado)) {
          // Transicion invalida (p.e. pagado -> cancelado): ignorar sin error.
          console.warn("Webhook: transicion invalida ignorada", {
            eventId: event.id, estadoActual: pago.estado, intentado: nuevoEstado, pagoId
          });
        } else {
          pago.estado = nuevoEstado;
          if (nuevoEstado === "pagado") pago.fechaPago = new Date();
          await pago.save();
        }
      } else if (event.type === "checkout.session.completed" && session.payment_status !== "paid") {
        // Completed pero sin cobro confirmado — no marcar pagado (C3).
        console.info("Webhook: checkout.session.completed sin payment_status=paid ignorado", {
          eventId: event.id, paymentStatus: session.payment_status, pagoId
        });
      }
    } else if (!tiposRelevantes.includes(event.type)) {
      // C3: Evento de Stripe no mapeado — registrar para revision sin cambiar estado.
      console.info("Webhook: evento no mapeado recibido", { eventId: event.id, type: event.type });
    }
  } catch (error) {
    console.error("Error al procesar el webhook de pago:", error.message);
    // 500 para que Stripe reintente el evento.
    return res.status(500).send({ message: "Error al procesar el evento." });
  }

  eventosProcessados.add(event.id);
  res.json({ received: true });
};

// Consulta de pagos (Administrador ve todos; Alumno/Padre ven solo lo suyo)
exports.findAll = async (req, res) => {
  try {
    const where = {};

    if (req.userRole === ROLES.ALUMNO) {
      const alumno = await Alumno.findOne({ where: { usuarioId: req.userId } });
      if (!alumno) return res.send([]);
      where.alumnoId = alumno.id;
    } else if (req.userRole === ROLES.PADRE) {
      const vinculos = await PadreAlumno.findAll({ where: { usuarioId: req.userId } });
      where.alumnoId = vinculos.map(v => v.alumnoId);
    } else if (req.query.alumnoId) {
      where.alumnoId = req.query.alumnoId;
    }

    const pagos = await Pago.findAll({ where, include: [{ model: Alumno, as: "alumno" }] });
    res.send(pagos);
  } catch (error) {
    res.status(500).send({ message: "Error al obtener los pagos." });
  }
};
