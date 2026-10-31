process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "clave-de-pruebas-con-mas-de-32-caracteres";
process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
process.env.FRONTEND_URL = "https://portal.test";

// Estas pruebas usan SQLite en memoria y un Stripe simulado: NO prueban la comunicación real con Stripe.
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const Stripe = require("stripe");

const db = require("../app/models");
const app = require("../app");
const pagoController = require("../app/controllers/pago.controller.js");

const PASSWORD = "ClaveSegura123";
const ctx = { tokens: {} };
const auth = token => ({ Authorization: `Bearer ${token}` });
const originalLog = console.log;
const originalError = console.error;

const stripeCalls = { created: [], expired: [], refunds: [] };
let sessionCounter = 0;
let sessionStatus = "open";
let refundShouldFail = false;
let sessionSuccessUrl = null;
let refundStatus = null;
const refundStore = [];

function stripeMock() {
  return {
    checkout: {
      sessions: {
        create: async input => {
          stripeCalls.created.push(input);
          sessionCounter += 1;
          return { id: `cs_test_${sessionCounter}`, url: `https://checkout.stripe.test/${sessionCounter}` };
        },
        retrieve: async id => {
          const index = Number(id.replace("cs_test_", "")) - 1;
          return {
            id, status: sessionStatus, url: `https://checkout.stripe.test/${id}`,
            success_url: sessionSuccessUrl ?? stripeCalls.created[index]?.success_url
          };
        },
        expire: async id => {
          stripeCalls.expired.push(id);
          if (sessionStatus === "complete") throw new Error("session already complete");
          sessionStatus = "expired";
          return { id, status: "expired" };
        }
      }
    },
    refunds: {
      create: async (input, options = {}) => {
        if (refundShouldFail) throw new Error("refund failed");
        const previo = options.idempotencyKey && refundStore.find(r => r.key === options.idempotencyKey);
        if (previo) return previo.refund;
        stripeCalls.refunds.push(input);
        const refund = {
          id: `re_test_${stripeCalls.refunds.length}`,
          status: refundStatus || "succeeded",
          amount: input.amount,
          currency: "usd",
          payment_intent: input.payment_intent,
          metadata: input.metadata || {}
        };
        refundStore.push({ key: options.idempotencyKey, refund });
        return refund;
      },
      list: async params => ({ data: refundStore.map(r => r.refund).filter(r => r.payment_intent === params.payment_intent) })
    },
    webhooks: Stripe.webhooks
  };
}

async function crearUsuario(username, rol) {
  return db.usuarios.create({
    username, email: `${username}@prueba.edu`, password: bcrypt.hashSync(PASSWORD, 4), rol
  });
}

async function login(username) {
  const res = await request(app).post("/api/auth/signin").send({ username, password: PASSWORD });
  assert.equal(res.status, 200);
  return res.body.token;
}

function firmar(payload) {
  const body = JSON.stringify(payload);
  const header = Stripe.webhooks.generateTestHeaderString({
    payload: body, secret: process.env.STRIPE_WEBHOOK_SECRET
  });
  return { body, header };
}

let eventCounter = 0;
function enviarWebhook(type, session) {
  eventCounter += 1;
  const { body, header } = firmar({
    id: `evt_fin_${eventCounter}`, object: "event", type, data: { object: session }
  });
  return request(app).post("/api/pagos/webhook")
    .set("Content-Type", "application/json").set("Stripe-Signature", header).send(body);
}

const crearCargo = (token, extra = {}) => request(app).post("/api/cargos").set(auth(token)).send({
  alumnoId: ctx.al1, concepto: "Colegiatura Octubre", montoOriginal: 100, moneda: "USD",
  fechaEmision: "2026-10-01", ...extra
});

const iniciarCheckout = (token, body) => request(app).post("/api/pagos/checkout").set(auth(token)).send(body);

async function pagarPorWebhook(checkoutBody, cargo, monto) {
  const pago = await db.pagos.findByPk(checkoutBody.pagoId);
  return enviarWebhook("checkout.session.completed", {
    id: checkoutBody.sessionId,
    payment_status: "paid",
    amount_total: Math.round(monto * 100),
    currency: "usd",
    payment_intent: `pi_test_${pago.id}`,
    metadata: { pagoId: String(pago.id), cargoId: String(cargo.id) }
  });
}

test.before(async () => {
  console.log = () => {};
  console.error = () => {};
  await db.sequelize.sync({ force: true });
  const grado = await db.gradosCarreras.create({ nombre: "Ingeniería", descripcion: "A" });
  await crearUsuario("admin", "admin");
  const uAl1 = await crearUsuario("alumno1", "alumno");
  const uAl2 = await crearUsuario("alumno2", "alumno");
  const uPadre = await crearUsuario("padre1", "padre");
  const uPadre2 = await crearUsuario("padre2", "padre");
  ctx.al1 = (await db.alumnos.create({
    nombre: "Luis", apellido: "Uno", email: "luis@prueba.edu", gradoCarreraId: grado.id, usuarioId: uAl1.id
  })).id;
  ctx.al2 = (await db.alumnos.create({
    nombre: "Mia", apellido: "Dos", email: "mia@prueba.edu", gradoCarreraId: grado.id, usuarioId: uAl2.id
  })).id;
  await db.padresAlumnos.create({ usuarioId: uPadre.id, alumnoId: ctx.al1 });
  await db.padresAlumnos.create({ usuarioId: uPadre2.id, alumnoId: ctx.al2 });
  const ciclo = await db.ciclosAcademicos.create({
    nombre: "2026", fechaInicio: "2026-01-01", fechaFin: "2026-12-31", estado: "abierto"
  });
  ctx.ciclo = ciclo.id;
  ctx.periodo = (await db.periodosAcademicos.create({
    cicloAcademicoId: ciclo.id, nombre: "Semestre 2", tipo: "semestre",
    fechaInicio: "2026-07-01", fechaFin: "2026-12-31", estado: "abierto"
  })).id;
  for (const u of ["admin", "alumno1", "alumno2", "padre1", "padre2"]) ctx.tokens[u] = await login(u);
  pagoController._testing.setStripeFactory(stripeMock);
});

test.after(async () => {
  console.log = originalLog;
  console.error = originalError;
  pagoController._testing.resetStripeFactory();
  await db.sequelize.close();
});

test("el administrador crea varios cargos seguidos para el mismo alumno y concepto", async () => {
  const primero = await crearCargo(ctx.tokens.admin);
  assert.equal(primero.status, 201);
  assert.equal(primero.body.estado, "pendiente");
  assert.equal(primero.body.saldoPendiente, 100);
  const segundo = await crearCargo(ctx.tokens.admin);
  assert.equal(segundo.status, 201, "un cargo previo no debe bloquear otro cargo");
  assert.notEqual(primero.body.id, segundo.body.id);
});

test("validaciones al crear un cargo", async () => {
  const casos = [
    [{ alumnoId: undefined }, 400],
    [{ alumnoId: 99999 }, 404],
    [{ concepto: "   " }, 400],
    [{ concepto: "x".repeat(161) }, 400],
    [{ montoOriginal: 0 }, 400],
    [{ montoOriginal: 10.123 }, 400],
    [{ moneda: "EUR" }, 400],
    [{ fechaEmision: "01/10/2026" }, 400],
    [{ fechaEmision: "2026-10-10", fechaVencimiento: "2026-10-01" }, 400],
    [{ periodoAcademicoId: 99999 }, 404],
    [{ cicloAcademicoId: 99999 }, 404]
  ];
  for (const [extra, status] of casos) {
    const res = await crearCargo(ctx.tokens.admin, extra);
    assert.equal(res.status, status, JSON.stringify(extra));
  }
  const inactivo = await db.alumnos.create({
    nombre: "In", apellido: "Activo", email: "in@prueba.edu", activo: false
  }).catch(() => null);
  if (inactivo) assert.equal((await crearCargo(ctx.tokens.admin, { alumnoId: inactivo.id })).status, 404);
});

test("el período deduce el ciclo y los cargos sin período siguen visibles al filtrar por período", async () => {
  const conPeriodo = await crearCargo(ctx.tokens.admin, {
    concepto: "Con período", periodoAcademicoId: ctx.periodo
  });
  assert.equal(conPeriodo.status, 201);
  assert.equal(conPeriodo.body.cicloAcademicoId, ctx.ciclo);
  const sinPeriodo = await crearCargo(ctx.tokens.admin, { concepto: "Sin período" });
  assert.equal(sinPeriodo.status, 201);

  const estricto = await request(app).get(`/api/cargos?alumnoId=${ctx.al1}&periodoAcademicoId=${ctx.periodo}`)
    .set(auth(ctx.tokens.admin));
  assert.ok(!estricto.body.some(c => c.id === sinPeriodo.body.id));
  const amplio = await request(app)
    .get(`/api/cargos?alumnoId=${ctx.al1}&periodoAcademicoId=${ctx.periodo}&incluirSinPeriodo=true`)
    .set(auth(ctx.tokens.admin));
  assert.ok(amplio.body.some(c => c.id === sinPeriodo.body.id));
  assert.ok(amplio.body.some(c => c.id === conPeriodo.body.id));
});

test("permisos: solo el administrador crea cargos; padre y alumno solo consultan lo suyo", async () => {
  for (const u of ["padre1", "alumno1"]) {
    assert.equal((await crearCargo(ctx.tokens[u])).status, 403);
  }
  assert.equal((await request(app).post("/api/cargos").send({})).status, 403);

  const cargo = (await crearCargo(ctx.tokens.admin, { concepto: "Visible" })).body;
  const padre = await request(app).get(`/api/cargos?alumnoId=${ctx.al1}`).set(auth(ctx.tokens.padre1));
  assert.equal(padre.status, 200);
  assert.ok(padre.body.some(c => c.id === cargo.id));
  assert.ok(padre.body.every(c => c.alumnoId === ctx.al1));
  assert.equal((await request(app).get(`/api/cargos?alumnoId=${ctx.al2}`).set(auth(ctx.tokens.padre1))).status, 403);
  assert.equal((await request(app).get(`/api/cargos?alumnoId=${ctx.al2}`).set(auth(ctx.tokens.alumno1))).status, 403);
  const admin = await request(app).get(`/api/cargos?alumnoId=${ctx.al1}`).set(auth(ctx.tokens.admin));
  assert.equal(admin.status, 200);
});

test("flujo completo: checkout, webhook firmado, saldo, doble pago y nuevo cargo", async () => {
  const cargo = (await crearCargo(ctx.tokens.admin, { concepto: "Flujo completo" })).body;

  assert.equal((await iniciarCheckout(ctx.tokens.padre2, { cargoId: cargo.id })).status, 403);
  assert.equal((await iniciarCheckout(ctx.tokens.admin, { cargoId: cargo.id })).status, 403);

  const checkout = await iniciarCheckout(ctx.tokens.padre1, { cargoId: cargo.id });
  assert.equal(checkout.status, 200);
  assert.match(checkout.body.url, /^https:\/\/checkout\.stripe\.test\//);
  const sesion = stripeCalls.created.at(-1);
  assert.equal(
    sesion.success_url,
    `https://portal.test/pago-exitoso?pago_id=${checkout.body.pagoId}&session_id={CHECKOUT_SESSION_ID}`
  );
  assert.equal(sesion.cancel_url, `https://portal.test/pago-cancelado?pago_id=${checkout.body.pagoId}`);
  assert.equal(sesion.line_items[0].price_data.unit_amount, 10000);
  assert.equal(sesion.line_items[0].price_data.currency, "usd");

  // Un Checkout abierto se reutiliza y no crea otra sesión.
  const total = stripeCalls.created.length;
  const repetido = await iniciarCheckout(ctx.tokens.padre1, { cargoId: cargo.id });
  assert.equal(repetido.status, 200);
  assert.equal(repetido.body.reutilizado, true);
  assert.equal(stripeCalls.created.length, total);

  // El retorno de Stripe no confirma nada: sigue pendiente hasta el webhook.
  const antes = await request(app).get(`/api/cargos?alumnoId=${ctx.al1}`).set(auth(ctx.tokens.padre1));
  assert.equal(antes.body.find(c => c.id === cargo.id).saldoPendiente, 100);

  const webhook = await pagarPorWebhook(checkout.body, cargo, 100);
  assert.equal(webhook.status, 200);
  const despues = await request(app).get(`/api/cargos?alumnoId=${ctx.al1}`).set(auth(ctx.tokens.padre1));
  const actualizado = despues.body.find(c => c.id === cargo.id);
  assert.equal(actualizado.estado, "pagado");
  assert.equal(actualizado.saldoPendiente, 0);
  assert.equal(actualizado.montoPagado, 100);

  const yaPagado = await iniciarCheckout(ctx.tokens.padre1, { cargoId: cargo.id });
  assert.equal(yaPagado.status, 409);
  assert.match(yaPagado.body.message, /ya está pagado/);

  const otro = await crearCargo(ctx.tokens.admin, { concepto: "Otro cargo tras pagar" });
  assert.equal(otro.status, 201);
});

test("webhook con firma inválida no modifica pagos y un abono parcial deja saldo", async () => {
  const cargo = (await crearCargo(ctx.tokens.admin, { concepto: "Parcial" })).body;
  const checkout = await iniciarCheckout(ctx.tokens.alumno1, { cargoId: cargo.id, monto: 40 });
  assert.equal(checkout.status, 200);

  const falso = await request(app).post("/api/pagos/webhook")
    .set("Content-Type", "application/json").set("Stripe-Signature", "t=1,v1=falsa").send("{}");
  assert.equal(falso.status, 400);
  assert.equal((await db.pagos.findByPk(checkout.body.pagoId)).estado, "pendiente");

  assert.equal((await iniciarCheckout(ctx.tokens.alumno1, { cargoId: cargo.id, monto: 100.01 })).status, 400);
  await pagarPorWebhook(checkout.body, cargo, 40);
  const lista = await request(app).get(`/api/cargos?alumnoId=${ctx.al1}`).set(auth(ctx.tokens.alumno1));
  const parcial = lista.body.find(c => c.id === cargo.id);
  assert.equal(parcial.estado, "parcial");
  assert.equal(parcial.saldoPendiente, 60);
});

test("el webhook no exige FRONTEND_URL; el checkout en producción sí", async () => {
  const entorno = process.env.NODE_ENV;
  const frontend = process.env.FRONTEND_URL;
  const cargo = (await crearCargo(ctx.tokens.admin, { concepto: "Config" })).body;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.FRONTEND_URL;
    const checkout = await iniciarCheckout(ctx.tokens.alumno1, { cargoId: cargo.id });
    assert.equal(checkout.status, 503);
    assert.match(checkout.body.message, /FRONTEND_URL/);

    const { body, header } = firmar({
      id: "evt_sin_frontend", object: "event", type: "customer.created", data: { object: {} }
    });
    const webhook = await request(app).post("/api/pagos/webhook")
      .set("Content-Type", "application/json").set("Stripe-Signature", header).send(body);
    assert.equal(webhook.status, 200);

    process.env.FRONTEND_URL = "no es una url";
    assert.equal((await iniciarCheckout(ctx.tokens.alumno1, { cargoId: cargo.id })).status, 503);
  } finally {
    process.env.NODE_ENV = entorno;
    process.env.FRONTEND_URL = frontend;
  }
});

test("los pagos no se eliminan: DELETE responde 405 y el registro permanece", async () => {
  const cargo = (await crearCargo(ctx.tokens.admin, { concepto: "Sin borrar" })).body;
  const checkout = await iniciarCheckout(ctx.tokens.alumno1, { cargoId: cargo.id });
  const res = await request(app).delete(`/api/pagos/${checkout.body.pagoId}`).set(auth(ctx.tokens.admin));
  assert.equal(res.status, 405);
  assert.ok(await db.pagos.findByPk(checkout.body.pagoId));
});

test("anular exige administrador, motivo y un pago existente", async () => {
  const cargo = (await crearCargo(ctx.tokens.admin, { concepto: "Permisos anulación" })).body;
  const checkout = await iniciarCheckout(ctx.tokens.alumno1, { cargoId: cargo.id });
  const url = `/api/pagos/${checkout.body.pagoId}/anular`;
  for (const u of ["padre1", "alumno1"]) {
    assert.equal((await request(app).patch(url).set(auth(ctx.tokens[u])).send({ motivo: "intento" })).status, 403);
  }
  assert.equal((await request(app).patch(url).set(auth(ctx.tokens.admin)).send({})).status, 400);
  assert.equal((await request(app).patch("/api/pagos/99999/anular")
    .set(auth(ctx.tokens.admin)).send({ motivo: "No existe" })).status, 404);
  assert.equal((await db.pagos.findByPk(checkout.body.pagoId)).estado, "pendiente");
});

test("cancelar un checkout pendiente expira la sesión y libera al cargo", async () => {
  sessionStatus = "open";
  const cargo = (await crearCargo(ctx.tokens.admin, { concepto: "Checkout cancelado" })).body;
  const checkout = await iniciarCheckout(ctx.tokens.alumno1, { cargoId: cargo.id });

  // Con un pago pendiente el cargo no se puede anular.
  assert.equal((await request(app).patch(`/api/cargos/${cargo.id}/anular`)
    .set(auth(ctx.tokens.admin)).send({ motivo: "Prueba" })).status, 409);

  const res = await request(app).patch(`/api/pagos/${checkout.body.pagoId}/anular`)
    .set(auth(ctx.tokens.admin)).send({ motivo: "Checkout abandonado" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.estado, "cancelado");
  assert.ok(stripeCalls.expired.includes(checkout.body.sessionId));
  const pago = await db.pagos.findByPk(checkout.body.pagoId);
  assert.equal(pago.estado, "cancelado");
  assert.equal(pago.motivoAnulacion, "Checkout abandonado");

  // Repetir la operación no es posible y un webhook tardío no revive el pago.
  assert.equal((await request(app).patch(`/api/pagos/${pago.id}/anular`)
    .set(auth(ctx.tokens.admin)).send({ motivo: "Otra vez" })).status, 409);
  await pagarPorWebhook(checkout.body, cargo, 100);
  assert.equal((await db.pagos.findByPk(pago.id)).estado, "cancelado");

  // El cargo vuelve a poder pagarse con un Checkout nuevo.
  sessionStatus = "open";
  assert.equal((await iniciarCheckout(ctx.tokens.alumno1, { cargoId: cargo.id })).status, 200);
});

test("anular un pago confirmado lo revierte contablemente sin borrarlo y permite crear otro cargo", async () => {
  const cargo = (await crearCargo(ctx.tokens.admin, { concepto: "Pago a anular" })).body;
  const checkout = await iniciarCheckout(ctx.tokens.padre1, { cargoId: cargo.id });
  await pagarPorWebhook(checkout.body, cargo, 100);
  assert.equal((await db.pagos.findByPk(checkout.body.pagoId)).estado, "pagado");

  const sinMotivo = await request(app).patch(`/api/pagos/${checkout.body.pagoId}/anular`)
    .set(auth(ctx.tokens.admin)).send({ motivo: "  " });
  assert.equal(sinMotivo.status, 400);

  const res = await request(app).patch(`/api/pagos/${checkout.body.pagoId}/anular`)
    .set(auth(ctx.tokens.admin)).send({ motivo: "Cobro duplicado" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.estado, "anulado");
  assert.equal(res.body.reembolsado, false);
  assert.equal(stripeCalls.refunds.length, 0);

  const pago = await db.pagos.findByPk(checkout.body.pagoId);
  assert.equal(pago.estado, "anulado");
  assert.equal(pago.anuladoPorId !== null, true);
  assert.ok(pago.fechaPago, "se conserva la fecha original del cobro");

  const lista = await request(app).get(`/api/cargos?alumnoId=${ctx.al1}`).set(auth(ctx.tokens.admin));
  const actualizado = lista.body.find(c => c.id === cargo.id);
  assert.equal(actualizado.estado, "pendiente");
  assert.equal(actualizado.saldoPendiente, 100);
  assert.equal(actualizado.pagos.length, 1, "el pago anulado sigue en el historial");

  assert.equal((await request(app).patch(`/api/pagos/${pago.id}/anular`)
    .set(auth(ctx.tokens.admin)).send({ motivo: "Segunda anulación" })).status, 409);
  assert.equal((await crearCargo(ctx.tokens.admin, { concepto: "Cargo posterior a anulación" })).status, 201);
});

test("anular con reembolso crea el Refund en Stripe y, si falla, no cambia el pago", async () => {
  const cargo = (await crearCargo(ctx.tokens.admin, { concepto: "Reembolso" })).body;
  const checkout = await iniciarCheckout(ctx.tokens.padre1, { cargoId: cargo.id });
  await pagarPorWebhook(checkout.body, cargo, 100);
  const url = `/api/pagos/${checkout.body.pagoId}/anular`;

  refundShouldFail = true;
  const fallo = await request(app).patch(url).set(auth(ctx.tokens.admin))
    .send({ motivo: "Devolución", reembolsar: true });
  refundShouldFail = false;
  assert.equal(fallo.status, 502);
  assert.equal((await db.pagos.findByPk(checkout.body.pagoId)).estado, "pagado");

  const ok = await request(app).patch(url).set(auth(ctx.tokens.admin))
    .send({ motivo: "Devolución", reembolsar: true });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.reembolsado, true);
  assert.equal(stripeCalls.refunds.at(-1).payment_intent, `pi_test_${checkout.body.pagoId}`);
  assert.equal((await db.pagos.findByPk(checkout.body.pagoId)).stripeRefundId, `re_test_${stripeCalls.refunds.length}`);

  assert.equal((await request(app).patch(url).set(auth(ctx.tokens.admin))
    .send({ motivo: "Devolución", reembolsar: "si" })).status, 400);
});

test("una sesión expirada se reemplaza automáticamente por un Checkout nuevo", async () => {
  const cargo = (await crearCargo(ctx.tokens.admin, { concepto: "Sesión expirada" })).body;
  sessionStatus = "open";
  const primero = await iniciarCheckout(ctx.tokens.alumno1, { cargoId: cargo.id });
  assert.equal(primero.status, 200);
  sessionStatus = "expired";
  const segundo = await iniciarCheckout(ctx.tokens.alumno1, { cargoId: cargo.id });
  assert.equal(segundo.status, 200, JSON.stringify(segundo.body));
  assert.notEqual(segundo.body.pagoId, primero.body.pagoId);
  assert.equal((await db.pagos.findByPk(primero.body.pagoId)).estado, "cancelado");
  sessionStatus = "open";
});

test("un Checkout abierto con otra FRONTEND_URL se reemplaza en lugar de reutilizarse", async () => {
  const cargo = (await crearCargo(ctx.tokens.admin, { concepto: "URL antigua" })).body;
  const primero = await iniciarCheckout(ctx.tokens.alumno1, { cargoId: cargo.id });
  assert.equal(primero.status, 200);
  sessionSuccessUrl = "http://localhost:5173/pago-exitoso?pago_id=1&session_id={CHECKOUT_SESSION_ID}";
  const segundo = await iniciarCheckout(ctx.tokens.alumno1, { cargoId: cargo.id });
  sessionSuccessUrl = null;
  sessionStatus = "open";
  assert.equal(segundo.status, 200, JSON.stringify(segundo.body));
  assert.notEqual(segundo.body.pagoId, primero.body.pagoId);
  assert.notEqual(segundo.body.reutilizado, true);
  assert.equal((await db.pagos.findByPk(primero.body.pagoId)).estado, "cancelado");
  assert.ok(stripeCalls.expired.includes(primero.body.sessionId));
});

test("el alumno o padre autorizado cancela su Checkout; otros reciben 403 y un pago confirmado no se cancela", async () => {
  const cargo = (await crearCargo(ctx.tokens.admin, { concepto: "Cancelar propio" })).body;
  sessionStatus = "open";
  const checkout = await iniciarCheckout(ctx.tokens.padre1, { cargoId: cargo.id, monto: 30 });
  assert.equal(checkout.status, 200);
  const otroImporte = await iniciarCheckout(ctx.tokens.padre1, { cargoId: cargo.id, monto: 50 });
  assert.equal(otroImporte.status, 409);
  const url = `/api/pagos/${checkout.body.pagoId}/cancelar`;
  assert.equal((await request(app).post(url).set(auth(ctx.tokens.padre2))).status, 403);
  assert.equal((await request(app).post(url).set(auth(ctx.tokens.admin))).status, 403);
  assert.equal((await request(app).post("/api/pagos/99999/cancelar").set(auth(ctx.tokens.padre1))).status, 404);
  const ok = await request(app).post(url).set(auth(ctx.tokens.padre1));
  assert.equal(ok.status, 200);
  assert.equal((await db.pagos.findByPk(checkout.body.pagoId)).estado, "cancelado");
  assert.ok(stripeCalls.expired.includes(checkout.body.sessionId));
  assert.equal((await request(app).post(url).set(auth(ctx.tokens.padre1))).status, 409);

  sessionStatus = "open";
  const nuevo = await iniciarCheckout(ctx.tokens.padre1, { cargoId: cargo.id, monto: 50 });
  assert.equal(nuevo.status, 200);
  assert.equal(Number((await db.pagos.findByPk(nuevo.body.pagoId)).monto), 50);
  assert.equal((await pagarPorWebhook(nuevo.body, cargo, 50)).status, 200);
  assert.equal((await request(app).post(`/api/pagos/${nuevo.body.pagoId}/cancelar`).set(auth(ctx.tokens.padre1))).status, 409);
  assert.equal((await db.pagos.findByPk(nuevo.body.pagoId)).estado, "pagado");
});

test("si Stripe rechaza la sesión el pago se libera y se puede reintentar con otro importe", async () => {
  const cargo = (await crearCargo(ctx.tokens.admin, { concepto: "Stripe rechaza" })).body;
  const original = stripeMock;
  pagoController._testing.setStripeFactory(() => ({
    ...original(),
    checkout: { sessions: { create: async () => {
      const error = new Error("Amount must convert to at least 50 cents");
      error.type = "StripeInvalidRequestError";
      error.code = "amount_too_small";
      throw error;
    } } }
  }));
  const rechazado = await iniciarCheckout(ctx.tokens.padre1, { cargoId: cargo.id, monto: 0.5 });
  pagoController._testing.setStripeFactory(stripeMock);
  assert.equal(rechazado.status, 400);
  assert.match(rechazado.body.message, /mínimo/);
  assert.equal((await db.pagos.findAll({ where: { cargoId: cargo.id } })).every(p => p.estado === "cancelado"), true);
  const reintento = await iniciarCheckout(ctx.tokens.padre1, { cargoId: cargo.id, monto: 20 });
  assert.equal(reintento.status, 200);
});

test("un intento sin sesión en Stripe se reajusta al nuevo importe y no bloquea el cargo", async () => {
  const cargo = (await crearCargo(ctx.tokens.admin, { concepto: "Sin sesión" })).body;
  await db.pagos.create({
    alumnoId: ctx.al1, cargoId: cargo.id, concepto: cargo.concepto, monto: "10.00",
    moneda: "usd", estado: "pendiente", metodoPago: "stripe"
  });
  const respuesta = await iniciarCheckout(ctx.tokens.padre1, { cargoId: cargo.id, monto: 25 });
  assert.equal(respuesta.status, 200, JSON.stringify(respuesta.body));
  assert.equal(Number((await db.pagos.findByPk(respuesta.body.pagoId)).monto), 25);
  assert.equal(stripeCalls.created.at(-1).line_items[0].price_data.unit_amount, 2500);
});

test("cancelar: sesión ya expirada libera el cargo; sesión completa o Stripe caído no lo cancelan", async () => {
  const cargo = (await crearCargo(ctx.tokens.admin, { concepto: "Cancelar casos Stripe" })).body;
  sessionStatus = "open";
  const a = await iniciarCheckout(ctx.tokens.padre1, { cargoId: cargo.id, monto: 30 });
  const urlA = `/api/pagos/${a.body.pagoId}/cancelar`;

  // Stripe ya expiró la sesión: expire() falla pero el cargo debe liberarse.
  sessionStatus = "expired";
  assert.equal((await request(app).post(urlA).set(auth(ctx.tokens.padre1))).status, 200);
  assert.equal((await db.pagos.findByPk(a.body.pagoId)).estado, "cancelado");

  sessionStatus = "open";
  const b = await iniciarCheckout(ctx.tokens.padre1, { cargoId: cargo.id, monto: 30 });
  const urlB = `/api/pagos/${b.body.pagoId}/cancelar`;

  // Sesión completada en Stripe: no se cancela; el webhook la confirmará.
  sessionStatus = "complete";
  const completa = await request(app).post(urlB).set(auth(ctx.tokens.padre1));
  assert.equal(completa.status, 409);
  assert.equal((await db.pagos.findByPk(b.body.pagoId)).estado, "pendiente");

  // Stripe inaccesible: 502 y el pago queda intacto para reintentar.
  const original = stripeMock;
  pagoController._testing.setStripeFactory(() => ({
    ...original(),
    checkout: { sessions: {
      expire: async () => { throw new Error("network"); },
      retrieve: async () => { throw new Error("network"); }
    } }
  }));
  const caido = await request(app).post(urlB).set(auth(ctx.tokens.padre1));
  pagoController._testing.setStripeFactory(stripeMock);
  assert.equal(caido.status, 502);
  assert.equal((await db.pagos.findByPk(b.body.pagoId)).estado, "pendiente");

  assert.equal((await pagarPorWebhook(b.body, cargo, 30)).status, 200);
  assert.equal((await db.pagos.findByPk(b.body.pagoId)).estado, "pagado");
  sessionStatus = "open";
});

test("webhook: los cuatro eventos, duplicados y pagos confirmados que no se liberan", async () => {
  const cargo = (await crearCargo(ctx.tokens.admin, { concepto: "Eventos webhook", montoOriginal: 100 })).body;
  sessionStatus = "open";
  const evento = (tipo, pago, sessionId, extra = {}) => enviarWebhook(tipo, {
    id: sessionId, payment_status: "paid", amount_total: Math.round(Number(pago.monto) * 100), currency: "usd",
    payment_intent: `pi_ev_${pago.id}`, metadata: { pagoId: String(pago.id), cargoId: String(cargo.id) }, ...extra
  });
  const nuevo = async monto => {
    const r = await iniciarCheckout(ctx.tokens.padre1, { cargoId: cargo.id, monto });
    return { r, pago: await db.pagos.findByPk(r.body.pagoId) };
  };
  const estado = async id => (await db.pagos.findByPk(id)).estado;

  // async_payment_failed -> fallido; luego un nuevo checkout es posible.
  let x = await nuevo(10);
  assert.equal((await evento("checkout.session.completed", x.pago, x.r.body.sessionId, { payment_status: "unpaid" })).status, 200);
  assert.equal(await estado(x.pago.id), "pendiente");
  await evento("checkout.session.async_payment_failed", x.pago, x.r.body.sessionId, { payment_status: "unpaid" });
  assert.equal(await estado(x.pago.id), "fallido");

  // completed(unpaid) + async_payment_succeeded -> pagado; fallido/expirado posteriores no lo liberan.
  x = await nuevo(20);
  await evento("checkout.session.completed", x.pago, x.r.body.sessionId, { payment_status: "unpaid" });
  await evento("checkout.session.async_payment_succeeded", x.pago, x.r.body.sessionId);
  assert.equal(await estado(x.pago.id), "pagado");
  await evento("checkout.session.async_payment_failed", x.pago, x.r.body.sessionId);
  await evento("checkout.session.expired", x.pago, x.r.body.sessionId);
  assert.equal(await estado(x.pago.id), "pagado");
  assert.equal((await db.pagos.findByPk(x.pago.id)).stripePaymentIntentId, `pi_ev_${x.pago.id}`);

  // expired -> cancelado y el cargo queda libre.
  x = await nuevo(30);
  await evento("checkout.session.expired", x.pago, x.r.body.sessionId);
  assert.equal(await estado(x.pago.id), "cancelado");

  // Mismo evento repetido: un único registro y un solo pago (la concurrencia real se prueba en PostgreSQL).
  x = await nuevo(40);
  const { body, header } = firmar({
    id: "evt_paralelo", object: "event", type: "checkout.session.completed",
    data: { object: { id: x.r.body.sessionId, payment_status: "paid", amount_total: 4000, currency: "usd",
      payment_intent: "pi_par", metadata: { pagoId: String(x.pago.id), cargoId: String(cargo.id) } } }
  });
  const respuestas = [];
  for (let i = 0; i < 3; i += 1) {
    respuestas.push(await request(app).post("/api/pagos/webhook")
      .set("Content-Type", "application/json").set("Stripe-Signature", header).send(body));
  }
  assert.ok(respuestas.every(r => r.status === 200));
  assert.deepEqual(respuestas.map(r => Boolean(r.body.duplicate)), [false, true, true]);
  assert.equal(await db.eventosStripe.count({ where: { stripeEventId: "evt_paralelo" } }), 1);
  assert.equal(await estado(x.pago.id), "pagado");

  const cargos = (await request(app).get("/api/cargos").set(auth(ctx.tokens.padre1))).body;
  assert.equal(cargos.find(c => c.id === cargo.id).montoPagado, 60);
});

test("reembolso: estados fallido/cancelado no anulan el pago; pendiente no anula hasta confirmarse", async () => {
  const pagarCargo = async concepto => {
    const cargo = (await crearCargo(ctx.tokens.admin, { concepto })).body;
    sessionStatus = "open";
    const checkout = await iniciarCheckout(ctx.tokens.padre1, { cargoId: cargo.id });
    assert.equal((await pagarPorWebhook(checkout.body, cargo, 100)).status, 200);
    return { cargo, pagoId: checkout.body.pagoId };
  };
  const anular = (pagoId, token = ctx.tokens.admin) => request(app).patch(`/api/pagos/${pagoId}/anular`)
    .set(auth(token)).send({ motivo: "Devolución", reembolsar: true });

  for (const estado of ["failed", "canceled"]) {
    const { cargo, pagoId } = await pagarCargo(`Reembolso ${estado}`);
    refundStatus = estado;
    const respuesta = await anular(pagoId);
    refundStatus = null;
    assert.equal(respuesta.status, 502);
    const pago = await db.pagos.findByPk(pagoId);
    assert.equal(pago.estado, "pagado");
    assert.equal(pago.stripeRefundId, null);
    const cargoActual = (await request(app).get("/api/cargos").set(auth(ctx.tokens.admin))).body.find(c => c.id === cargo.id);
    assert.equal(cargoActual.saldoPendiente, 0);
  }

  const pendiente = await pagarCargo("Reembolso pendiente");
  refundStatus = "pending";
  const enCurso = await anular(pendiente.pagoId);
  refundStatus = null;
  assert.equal(enCurso.status, 202);
  assert.equal(enCurso.body.reembolsoEnCurso, true);
  assert.equal(enCurso.body.reembolsado, false);
  const pagoEnCurso = await db.pagos.findByPk(pendiente.pagoId);
  assert.equal(pagoEnCurso.estado, "pagado", "el pago sigue pagado hasta que Stripe confirme");
  assert.ok(pagoEnCurso.stripeRefundId);

  const completo = await pagarCargo("Reembolso completo");
  refundStatus = "succeeded";
  const ok = await anular(completo.pagoId);
  refundStatus = null;
  assert.equal(ok.body.reembolsado, true);
  assert.equal(ok.body.reembolsoEnCurso, false);
  assert.equal((await anular(completo.pagoId, ctx.tokens.padre1)).status, 403);
});
