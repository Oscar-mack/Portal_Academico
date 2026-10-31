process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "clave-de-pruebas-con-mas-de-32-caracteres";
process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
process.env.FRONTEND_URL = "https://portal.test";

// Conciliación de reembolsos con un Stripe simulado (no prueba la comunicación real con Stripe).
// Por defecto usa SQLite en memoria. Con TEST_DATABASE_URL (PostgreSQL local) se ejecutan además las
// pruebas de concurrencia, que SQLite no puede representar. Con TEST_DATABASE_MIGRATED=1 se reutiliza una
// base ya migrada (001-007) y solo se vacían las tablas.
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const Stripe = require("stripe");

const db = require("../app/models");
const app = require("../app");
const pagoController = require("../app/controllers/pago.controller.js");

const esPostgres = Boolean(process.env.TEST_DATABASE_URL);
const soloPostgres = esPostgres ? {} : { skip: "requiere TEST_DATABASE_URL (PostgreSQL local)" };
const PASSWORD = "ClaveSegura123";
const ctx = { tokens: {} };
const auth = token => ({ Authorization: `Bearer ${token}` });
const originalLog = console.log;
const originalError = console.error;
const errores = [];

const stripeState = {
  refunds: [], // { key, refund }
  creates: 0,
  sessionKeys: [],
  byId: {},
  sessions: {}, // replay por clave de idempotencia, como Stripe
  sessionError: null
};
let sessionCounter = 0;
let refundCounter = 0;

function stripeMock() {
  return {
    checkout: {
      sessions: {
        create: async (input, options = {}) => {
          stripeState.sessionKeys.push(options.idempotencyKey);
          if (stripeState.sessionError) {
            const error = new Error("Stripe error simulado");
            error.type = stripeState.sessionError;
            throw error;
          }
          const previa = options.idempotencyKey && stripeState.sessions[options.idempotencyKey];
          if (previa) return previa;
          sessionCounter += 1;
          const sesion = {
            id: `cs_rf_${sessionCounter}`, url: `https://checkout.stripe.test/${sessionCounter}`, status: "open", success_url: input.success_url
          };
          stripeState.byId[sesion.id] = sesion;
          if (options.idempotencyKey) stripeState.sessions[options.idempotencyKey] = sesion;
          return sesion;
        },
        retrieve: async id => stripeState.byId[id] || { id, status: "open", url: `https://checkout.stripe.test/${id}` },
        expire: async id => ({ id, status: "expired" })
      }
    },
    refunds: {
      create: async (input, options = {}) => {
        const previo = stripeState.refunds.find(r => r.key === options.idempotencyKey);
        if (previo) return previo.refund;
        stripeState.creates += 1;
        refundCounter += 1;
        const refund = {
          id: `re_rf_${refundCounter}`,
          status: stripeState.nextStatus || "succeeded",
          amount: input.amount,
          currency: "usd",
          payment_intent: input.payment_intent,
          metadata: input.metadata || {}
        };
        stripeState.refunds.push({ key: options.idempotencyKey, refund });
        return refund;
      },
      list: async params => ({
        data: stripeState.refunds.map(r => r.refund).filter(r => r.payment_intent === params.payment_intent)
      })
    },
    webhooks: Stripe.webhooks
  };
}

let eventCounter = 0;
function hook(type, object, id) {
  eventCounter += 1;
  const body = JSON.stringify({ id: id || `evt_rf_${eventCounter}`, object: "event", type, data: { object } });
  const header = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: process.env.STRIPE_WEBHOOK_SECRET });
  return request(app).post("/api/pagos/webhook")
    .set("Content-Type", "application/json").set("Stripe-Signature", header).send(body);
}

const crearCargo = (extra = {}) => request(app).post("/api/cargos").set(auth(ctx.tokens.admin)).send({
  alumnoId: ctx.alumno, concepto: "Colegiatura", montoOriginal: 100, moneda: "USD", fechaEmision: "2026-10-01", ...extra
});
const checkout = body => request(app).post("/api/pagos/checkout").set(auth(ctx.tokens.padre)).send(body);
const anular = (pagoId, motivo = "Devolución solicitada") => request(app).patch(`/api/pagos/${pagoId}/anular`)
  .set(auth(ctx.tokens.admin)).send({ motivo, reembolsar: true });

// Crea un cargo y lo deja pagado mediante el webhook de Checkout.
async function pagoPagado() {
  const cargo = (await crearCargo()).body;
  const res = await checkout({ cargoId: cargo.id });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const pago = await db.pagos.findByPk(res.body.pagoId);
  const paid = await hook("checkout.session.completed", {
    id: res.body.sessionId, payment_status: "paid", amount_total: 10000, currency: "usd",
    payment_intent: `pi_rf_${pago.id}`, metadata: { pagoId: String(pago.id), cargoId: String(cargo.id) }
  });
  assert.equal(paid.status, 200);
  return { pagoId: pago.id, cargoId: cargo.id, pi: `pi_rf_${pago.id}` };
}

const refundObj = (p, extra = {}) => ({
  id: `re_ext_${p.pagoId}`, object: "refund", status: "succeeded", amount: 10000, currency: "usd",
  payment_intent: p.pi, metadata: { pagoId: String(p.pagoId) }, ...extra
});
const cargar = id => db.pagos.findByPk(id);
const saldoCargo = async cargoId =>
  (await request(app).get("/api/cargos").set(auth(ctx.tokens.admin))).body.find(c => c.id === cargoId).saldoPendiente;
const eventosDe = id => db.eventosStripe.findAll({ where: { stripeEventId: id } });

test.before(async () => {
  console.log = () => {};
  console.error = (...args) => { errores.push(args.join(" ")); };
  if (esPostgres && process.env.TEST_DATABASE_MIGRATED) {
    await db.sequelize.query(
      "TRUNCATE usuarios, alumnos, padre_alumnos, pagos, cargos, eventos_stripe, grado_carreras RESTART IDENTITY CASCADE"
    );
  } else if (esPostgres) {
    await db.sequelize.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await db.sequelize.sync({ force: true });
  } else {
    await db.sequelize.sync({ force: true });
  }
  const mk = (username, rol) => db.usuarios.create({
    username, email: `${username}@prueba.edu`, password: bcrypt.hashSync(PASSWORD, 4), rol
  });
  const grado = await db.gradosCarreras.create({ nombre: "Ingeniería", descripcion: "Prueba" });
  const admin = await mk("admin", "admin");
  const ualumno = await mk("alumno1", "alumno");
  const upadre = await mk("padre1", "padre");
  const alumno = await db.alumnos.create({
    nombre: "Luis", apellido: "Uno", email: "luis@prueba.edu", gradoCarreraId: grado.id, usuarioId: ualumno.id
  });
  await db.padresAlumnos.create({ usuarioId: upadre.id, alumnoId: alumno.id });
  ctx.alumno = alumno.id;
  ctx.adminId = admin.id;
  for (const [clave, username] of [["admin", "admin"], ["padre", "padre1"]]) {
    const res = await request(app).post("/api/auth/signin").send({ username, password: PASSWORD });
    assert.equal(res.status, 200);
    ctx.tokens[clave] = res.body.token;
  }
  pagoController._testing.setStripeFactory(stripeMock);
});

test.after(async () => {
  console.log = originalLog;
  console.error = originalError;
  pagoController._testing.resetStripeFactory();
  await db.sequelize.close();
});

test.beforeEach(() => { stripeState.nextStatus = null; stripeState.sessionError = null; });

test("reembolso exitoso con fallo de persistencia local: se concilia con el webhook", async () => {
  const p = await pagoPagado();
  let fallos = 1;
  db.pagos.addHook("beforeUpdate", "fallo-simulado", () => {
    if (fallos-- > 0) throw new Error("fallo simulado de base de datos");
  });
  const res = await anular(p.pagoId);
  db.pagos.removeHook("beforeUpdate", "fallo-simulado");
  assert.equal(res.status, 500);
  assert.match(res.body.message, /Stripe/);
  assert.equal((await cargar(p.pagoId)).estado, "pagado", "no hay estado a medias");
  assert.equal(stripeState.refunds.filter(r => r.refund.payment_intent === p.pi).length, 1);

  // Stripe confirma el reembolso que sí se creó: el webhook concilia sin intervención manual.
  const creado = stripeState.refunds.find(r => r.refund.payment_intent === p.pi).refund;
  const ev = await hook("refund.updated", { ...creado, object: "refund" });
  assert.equal(ev.status, 200);
  const pago = await cargar(p.pagoId);
  assert.equal(pago.estado, "anulado");
  assert.equal(pago.stripeRefundId, creado.id);
  assert.equal(pago.anuladoPorId, ctx.adminId, "toma el administrador de la metadata");
  assert.equal(await saldoCargo(p.cargoId), 100);
});

test("reintento de la anulación tras un fallo local reutiliza el reembolso existente", async () => {
  const p = await pagoPagado();
  db.pagos.addHook("beforeUpdate", "fallo-simulado", () => { throw new Error("fallo simulado"); });
  const fallo = await anular(p.pagoId);
  db.pagos.removeHook("beforeUpdate", "fallo-simulado");
  assert.equal(fallo.status, 500);
  const antes = stripeState.creates;
  const reintento = await anular(p.pagoId);
  assert.equal(reintento.status, 200);
  assert.equal(reintento.body.reembolsado, true);
  assert.equal(stripeState.creates, antes, "no se crea un segundo reembolso");
  const pago = await cargar(p.pagoId);
  assert.equal(pago.estado, "anulado");
  assert.equal(pago.stripeRefundId, stripeState.refunds.at(-1).refund.id);
});

test("reembolso pendiente: no anula, queda marcado y un webhook posterior lo completa", async () => {
  const p = await pagoPagado();
  stripeState.nextStatus = "pending";
  const res = await anular(p.pagoId);
  assert.equal(res.status, 202);
  assert.equal(res.body.reembolsoEnCurso, true);
  let pago = await cargar(p.pagoId);
  assert.equal(pago.estado, "pagado");
  assert.ok(pago.stripeRefundId);
  assert.equal(await saldoCargo(p.cargoId), 0, "el cargo sigue pagado");

  stripeState.nextStatus = null;
  const repetido = await anular(p.pagoId);
  assert.equal(repetido.status, 202, "repetir es idempotente");
  assert.equal(stripeState.refunds.filter(r => r.refund.payment_intent === p.pi).length, 1);

  const pendiente = stripeState.refunds.find(r => r.refund.payment_intent === p.pi).refund;
  assert.equal((await hook("refund.updated", { ...pendiente, status: "requires_action" })).status, 200);
  assert.equal((await cargar(p.pagoId)).estado, "pagado");
  assert.equal((await hook("refund.updated", { ...pendiente, status: "succeeded" })).status, 200);
  pago = await cargar(p.pagoId);
  assert.equal(pago.estado, "anulado");
  assert.equal(await saldoCargo(p.cargoId), 100);
});

test("reembolso pendiente que falla: nunca anula ni libera el cargo y se puede reintentar", async () => {
  const p = await pagoPagado();
  stripeState.nextStatus = "pending";
  assert.equal((await anular(p.pagoId)).status, 202);
  const pendiente = stripeState.refunds.find(r => r.refund.payment_intent === p.pi).refund;

  stripeState.refunds.find(r => r.refund.id === pendiente.id).refund.status = "failed";
  for (const tipo of ["refund.failed", "refund.updated"]) {
    const res = await hook(tipo, { ...pendiente, status: "failed" });
    assert.equal(res.status, 200);
    const pago = await cargar(p.pagoId);
    assert.equal(pago.estado, "pagado");
    assert.equal(pago.stripeRefundId, null, "se limpia la marca de reembolso en curso");
    assert.equal(await saldoCargo(p.cargoId), 0, "el cargo sigue pagado");
  }

  // Un nuevo intento usa otra clave de idempotencia (el anterior falló).
  stripeState.nextStatus = null;
  const nuevo = await anular(p.pagoId);
  assert.equal(nuevo.status, 200);
  assert.notEqual(stripeState.refunds.at(-1).refund.id, pendiente.id);
  assert.equal((await cargar(p.pagoId)).estado, "anulado");
});

test("un evento fallido o cancelado jamás revierte un pago ya anulado por ese reembolso", async () => {
  const p = await pagoPagado();
  assert.equal((await anular(p.pagoId)).status, 200);
  const refund = stripeState.refunds.find(r => r.refund.payment_intent === p.pi).refund;
  assert.equal((await hook("refund.failed", { ...refund, status: "failed" })).status, 200);
  const pago = await cargar(p.pagoId);
  assert.equal(pago.estado, "anulado");
  assert.equal(pago.stripeRefundId, refund.id);
  assert.ok(errores.some(e => e.includes("conciliación manual")));
});

test("evento duplicado: un solo registro y el estado no cambia", async () => {
  const p = await pagoPagado();
  const refund = refundObj(p);
  assert.equal((await hook("refund.created", refund, "evt_dup_1")).status, 200);
  const despues = await cargar(p.pagoId);
  assert.equal(despues.estado, "anulado");
  const repetido = await hook("refund.created", refund, "evt_dup_1");
  assert.equal(repetido.status, 200);
  assert.equal((await eventosDe("evt_dup_1")).length, 1);
  assert.equal((await cargar(p.pagoId)).anuladoEn.getTime(), despues.anuladoEn.getTime());
});

test("eventos fuera de orden: un 'pending' tardío no deshace el estado exitoso", async () => {
  const p = await pagoPagado();
  const refund = refundObj(p);
  assert.equal((await hook("refund.updated", refund)).status, 200);
  assert.equal((await hook("refund.created", { ...refund, status: "pending" })).status, 200);
  assert.equal((await hook("refund.updated", { ...refund, status: "requires_action" })).status, 200);
  const pago = await cargar(p.pagoId);
  assert.equal(pago.estado, "anulado");
  assert.equal(pago.stripeRefundId, refund.id);
});

test("charge.refunded se relaciona consultando los reembolsos reales del PaymentIntent", async () => {
  const p = await pagoPagado();
  stripeState.refunds.push({ key: "externo", refund: refundObj(p, { id: "re_dashboard" }) });
  const res = await hook("charge.refunded", { id: "ch_1", object: "charge", payment_intent: p.pi, amount_refunded: 10000 });
  assert.equal(res.status, 200);
  const pago = await cargar(p.pagoId);
  assert.equal(pago.estado, "anulado");
  assert.equal(pago.stripeRefundId, "re_dashboard");
  assert.equal((await db.eventosStripe.findOne({ where: { tipo: "charge.refunded", pagoId: p.pagoId } })) !== null, true);
  // El evento tardío de refund.created del mismo reembolso no cambia nada.
  assert.equal((await hook("refund.created", refundObj(p, { id: "re_dashboard" }))).status, 200);
  assert.equal((await cargar(p.pagoId)).stripeRefundId, "re_dashboard");
});

test("charge.refunded con error al consultar Stripe devuelve 500 y no registra el evento", async () => {
  const p = await pagoPagado();
  const original = stripeMock;
  pagoController._testing.setStripeFactory(() => {
    const s = original();
    s.refunds.list = async () => { throw new Error("Stripe caído"); };
    return s;
  });
  const res = await hook("charge.refunded", { id: "ch_2", object: "charge", payment_intent: p.pi }, "evt_ch_fail");
  pagoController._testing.setStripeFactory(stripeMock);
  assert.equal(res.status, 500);
  assert.equal((await eventosDe("evt_ch_fail")).length, 0, "Stripe lo reintentará");
  assert.equal((await cargar(p.pagoId)).estado, "pagado");
});

test("evento sin pago local relacionado: se registra para revisión y no modifica otros pagos", async () => {
  const otro = await pagoPagado();
  const antes = await cargar(otro.pagoId);
  const res = await hook("refund.created", {
    id: "re_huerfano", object: "refund", status: "succeeded", amount: 10000, currency: "usd",
    payment_intent: "pi_desconocido", metadata: { pagoId: String(otro.pagoId) }
  }, "evt_huerfano");
  assert.equal(res.status, 200);
  const registro = await eventosDe("evt_huerfano");
  assert.equal(registro.length, 1);
  assert.equal(registro[0].pagoId, null);
  assert.equal((await cargar(otro.pagoId)).estado, antes.estado);
  assert.ok(errores.some(e => e.includes("requiere revisión")));
});

test("validación de importe, moneda, PaymentIntent y pagoId de la metadata", async () => {
  const p = await pagoPagado();
  const otro = await pagoPagado();
  const casos = [
    ["importe parcial", refundObj(p, { amount: 4000 })],
    ["importe mayor", refundObj(p, { amount: 20000 })],
    ["moneda distinta", refundObj(p, { currency: "mxn" })],
    ["metadata de otro pago", refundObj(p, { metadata: { pagoId: String(otro.pagoId) } })],
    ["sin PaymentIntent", refundObj(p, { payment_intent: null })]
  ];
  for (const [nombre, refund] of casos) {
    const res = await hook("refund.updated", refund);
    assert.equal(res.status, 200, nombre);
    assert.equal((await cargar(p.pagoId)).estado, "pagado", nombre);
    assert.equal((await cargar(otro.pagoId)).estado, "pagado", `${nombre}: no toca pagos ajenos`);
  }
  // El PaymentIntent de otro pago nunca afecta a este.
  assert.equal((await hook("refund.updated", refundObj(p, { payment_intent: otro.pi, metadata: {} }))).status, 200);
  assert.equal((await cargar(p.pagoId)).estado, "pagado");
});

test("reembolsos parciales: el portal los rechaza de forma segura", async () => {
  const p = await pagoPagado();
  stripeState.refunds.push({ key: "parcial", refund: refundObj(p, { id: "re_parcial", amount: 3000 }) });
  const creados = stripeState.creates;
  const res = await anular(p.pagoId);
  assert.equal(res.status, 409);
  assert.equal(stripeState.creates, creados);
  assert.equal((await cargar(p.pagoId)).estado, "pagado");
  // El evento del reembolso parcial tampoco modifica el pago.
  assert.equal((await hook("refund.created", refundObj(p, { id: "re_parcial", amount: 3000 }))).status, 200);
  assert.equal((await cargar(p.pagoId)).estado, "pagado");
});

test("Checkout y 5xx: StripeAPIError cancela el intento; un error de red conserva el pago y la clave", async () => {
  const cargo = (await crearCargo()).body;
  stripeState.sessionKeys.length = 0;
  stripeState.sessionError = "StripeAPIError";
  const fallo = await checkout({ cargoId: cargo.id });
  assert.equal(fallo.status, 502);
  const cancelado = await db.pagos.findAll({ where: { cargoId: cargo.id } });
  assert.deepEqual(cancelado.map(x => x.estado), ["cancelado"]);

  stripeState.sessionError = null;
  const reintento = await checkout({ cargoId: cargo.id });
  assert.equal(reintento.status, 200);
  assert.notEqual(reintento.body.pagoId, cancelado[0].id);
  assert.notEqual(stripeState.sessionKeys[0], stripeState.sessionKeys[1], "otra clave de idempotencia");

  const cargo2 = (await crearCargo()).body;
  stripeState.sessionKeys.length = 0;
  stripeState.sessionError = "StripeConnectionError";
  assert.equal((await checkout({ cargoId: cargo2.id })).status, 502);
  const pendiente = await db.pagos.findAll({ where: { cargoId: cargo2.id } });
  assert.deepEqual(pendiente.map(x => x.estado), ["pendiente"]);
  stripeState.sessionError = null;
  const ok = await checkout({ cargoId: cargo2.id });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.pagoId, pendiente[0].id);
  assert.equal(stripeState.sessionKeys[0], stripeState.sessionKeys[1], "misma clave: replay seguro");
});

test("concurrencia: el mismo evento entregado en paralelo se procesa una sola vez", soloPostgres, async () => {
  const p = await pagoPagado();
  const refund = refundObj(p);
  const respuestas = await Promise.all(Array.from({ length: 8 }, () => hook("refund.updated", refund, "evt_par_1")));
  assert.ok(respuestas.every(r => r.status === 200), respuestas.map(r => r.status).join(","));
  assert.equal((await eventosDe("evt_par_1")).length, 1);
  assert.equal((await cargar(p.pagoId)).estado, "anulado");
});

test("concurrencia: eventos distintos del mismo reembolso convergen a un único estado", soloPostgres, async () => {
  const p = await pagoPagado();
  stripeState.refunds.push({ key: "par", refund: refundObj(p, { id: "re_par" }) });
  const refund = refundObj(p, { id: "re_par" });
  const respuestas = await Promise.all([
    hook("refund.created", { ...refund, status: "pending" }),
    hook("refund.updated", refund),
    hook("charge.refunded", { id: "ch_p", object: "charge", payment_intent: p.pi }),
    hook("refund.updated", { ...refund, status: "requires_action" }),
    hook("refund.updated", refund)
  ]);
  assert.ok(respuestas.every(r => r.status === 200), respuestas.map(r => r.status).join(","));
  const pago = await cargar(p.pagoId);
  assert.equal(pago.estado, "anulado");
  assert.equal(pago.stripeRefundId, "re_par");
  assert.equal(await saldoCargo(p.cargoId), 100);
});

test("concurrencia: tres anulaciones simultáneas crean un único reembolso", soloPostgres, async () => {
  const p = await pagoPagado();
  const antes = stripeState.creates;
  const respuestas = await Promise.all([anular(p.pagoId), anular(p.pagoId), anular(p.pagoId)]);
  const estados = respuestas.map(r => r.status).sort();
  assert.deepEqual(estados, [200, 409, 409]);
  assert.equal(stripeState.creates - antes, 1);
  assert.equal((await cargar(p.pagoId)).estado, "anulado");
});

test("concurrencia: anulación simultánea con el webhook de un reembolso externo", soloPostgres, async () => {
  const p = await pagoPagado();
  stripeState.refunds.push({ key: "ext", refund: refundObj(p, { id: "re_ext_par" }) });
  const [a, b] = await Promise.all([anular(p.pagoId), hook("refund.created", refundObj(p, { id: "re_ext_par" }))]);
  assert.equal(b.status, 200);
  assert.ok([200, 409].includes(a.status), String(a.status));
  const pago = await cargar(p.pagoId);
  assert.equal(pago.estado, "anulado");
  assert.equal(pago.stripeRefundId, "re_ext_par");
  assert.equal(await saldoCargo(p.cargoId), 100);
});

test("concurrencia: cuatro Checkouts simultáneos del mismo cargo dejan un único pago pendiente", soloPostgres, async () => {
  const cargo = (await crearCargo()).body;
  const respuestas = await Promise.all(Array.from({ length: 4 }, () => checkout({ cargoId: cargo.id })));
  assert.ok(respuestas.every(r => r.status === 200), respuestas.map(r => r.status).join(","));
  assert.equal(new Set(respuestas.map(r => r.body.sessionId)).size, 1);
  const pagos = await db.pagos.findAll({ where: { cargoId: cargo.id, estado: "pendiente" } });
  assert.equal(pagos.length, 1);
});
