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
    throw new Error("STRIPE_SECRET_KEY no está configurada.");
  }
  return Stripe(process.env.STRIPE_SECRET_KEY);
};

// RF-13 — Pagos de colegiatura u otros servicios (Alumno o Padre/Tutor del alumno)
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
      return res.status(400).send({ message: "El monto debe ser mayor que cero y válido." });
    }

    const alumno = await Alumno.findByPk(alumnoId);
    if (!alumno) return res.status(404).send({ message: "El alumno indicado no existe." });

    // RN-08 equivalente aplicado a pagos: un padre solo paga por sus propios hijos;
    // un alumno solo puede pagar por sí mismo.
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

    const pago = await Pago.create({
      alumnoId, concepto, monto: montoNumerico, estado: "pendiente"
    });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: `${concepto} - ${alumno.nombre} ${alumno.apellido}` },
            unit_amount: montoEnCentavos
          },
          quantity: 1
        }
      ],
      success_url: SUCCESS_URL,
      cancel_url: CANCEL_URL,
      metadata: { pagoId: String(pago.id) }
    });

    pago.stripeSessionId = session.id;
    await pago.save();

    res.send({ pagoId: pago.id, sessionId: session.id, url: session.url });
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al crear la sesión de pago." });
  }
};

// Webhook de Stripe: confirma el pago cuando el checkout se completa.
exports.webhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const pagoId = session.metadata && session.metadata.pagoId;
    if (pagoId) {
      await Pago.update(
        { estado: "pagado", fechaPago: new Date() },
        { where: { id: pagoId } }
      );
    }
  }

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

