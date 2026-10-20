process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "clave-de-pruebas-con-mas-de-32-caracteres";
process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const Stripe = require("stripe");

const db = require("../app/models");
const app = require("../app");

const PASSWORD = "ClaveSegura123";
const ctx = {};
const logs = [];
const originalLog = console.log;
const originalError = console.error;

async function crearUsuario(username, rol) {
  return db.usuarios.create({
    username,
    email: `${username}@prueba.edu`,
    password: bcrypt.hashSync(PASSWORD, 4),
    rol
  });
}

async function login(username, password = PASSWORD) {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res;
}

const auth = token => ({ Authorization: `Bearer ${token}` });

test.before(async () => {
  console.log = (...args) => logs.push(args.join(" "));
  console.error = (...args) => logs.push(args.join(" "));

  await db.sequelize.sync({ force: true });

  const gradoA = await db.gradosCarreras.create({ nombre: "Ingeniería", descripcion: "A" });
  const gradoB = await db.gradosCarreras.create({ nombre: "Derecho", descripcion: "B" });
  ctx.gradoA = gradoA.id;
  ctx.gradoB = gradoB.id;

  const crearCurso = (nombre, codigo, gradoCarreraId) =>
    db.cursos.create({ nombre, codigo, creditos: 4, gradoCarreraId });
  ctx.c1 = (await crearCurso("Matemática", "MAT1", gradoA.id)).id;
  ctx.c2 = (await crearCurso("Física", "FIS1", gradoA.id)).id;
  ctx.c3 = (await crearCurso("Civil", "CIV1", gradoB.id)).id;
  ctx.c4 = (await crearCurso("Química", "QUI1", gradoA.id)).id;

  await crearUsuario("admin", "admin");
  const uCat1 = await crearUsuario("cat1", "catedratico");
  const uCat2 = await crearUsuario("cat2", "catedratico");
  const uAl1 = await crearUsuario("alumno1", "alumno");
  const uAl2 = await crearUsuario("alumno2", "alumno");
  const uPadre = await crearUsuario("padre1", "padre");

  ctx.cat1 = (await db.catedraticos.create({
    nombre: "Ana", apellido: "Uno", email: "ana@prueba.edu", usuarioId: uCat1.id
  })).id;
  ctx.cat2 = (await db.catedraticos.create({
    nombre: "Beto", apellido: "Dos", email: "beto@prueba.edu", usuarioId: uCat2.id
  })).id;
  ctx.al1 = (await db.alumnos.create({
    nombre: "Luis", apellido: "Uno", email: "luis@prueba.edu", gradoCarreraId: gradoA.id, usuarioId: uAl1.id
  })).id;
  ctx.al2 = (await db.alumnos.create({
    nombre: "Mia", apellido: "Dos", email: "mia@prueba.edu", gradoCarreraId: gradoA.id, usuarioId: uAl2.id
  })).id;
  await db.padresAlumnos.create({ usuarioId: uPadre.id, alumnoId: ctx.al1 });

  const horario = (catedraticoId, cursoId, dia, horaInicio, horaFin) =>
    db.horariosCatedratico.create({ catedraticoId, cursoId, dia, horaInicio, horaFin, periodo: "2026" });
  await horario(ctx.cat1, ctx.c1, "Lunes", "08:00", "10:00");
  await horario(ctx.cat2, ctx.c2, "Lunes", "09:00", "11:00");
  await horario(ctx.cat2, ctx.c4, "Martes", "08:00", "10:00");

  // alumno1 cursa C1; alumno2 cursa C2.
  await db.asignacionesCurso.create({ alumnoId: ctx.al1, cursoId: ctx.c1, periodo: "2026" });
  await db.asignacionesCurso.create({ alumnoId: ctx.al2, cursoId: ctx.c2, periodo: "2026" });

  ctx.tokens = {};
  for (const u of ["admin", "cat1", "cat2", "alumno1", "alumno2", "padre1"]) {
    const res = await login(u);
    assert.equal(res.status, 200, `login de ${u}`);
    ctx.tokens[u] = res.body.token;
  }
  ctx.usuarioAlumno1 = uAl1.id;
});

test.after(async () => {
  console.log = originalLog;
  console.error = originalError;
  await db.sequelize.close();
});

test("health y readiness responden", async () => {
  assert.equal((await request(app).get("/health")).status, 200);
  assert.equal((await request(app).get("/ready")).status, 200);
});

test("un alumno no puede consultar información de otro alumno", async () => {
  const propio = await request(app).get(`/api/alumnos/${ctx.al1}`).set(auth(ctx.tokens.alumno1));
  assert.equal(propio.status, 200);

  const ajeno = await request(app).get(`/api/alumnos/${ctx.al2}`).set(auth(ctx.tokens.alumno1));
  assert.equal(ajeno.status, 403);

  const lista = await request(app).get("/api/alumnos").set(auth(ctx.tokens.alumno1));
  assert.deepEqual(lista.body.map(a => a.id), [ctx.al1]);

  const asignaciones = await request(app).get("/api/asignaciones-curso").set(auth(ctx.tokens.alumno1));
  assert.ok(asignaciones.body.every(a => a.alumnoId === ctx.al1));

  const notas = await request(app).get(`/api/notas?alumnoId=${ctx.al2}`).set(auth(ctx.tokens.alumno1));
  assert.ok(notas.body.every(n => n.alumnoId === ctx.al1));

  const boleta = await request(app).get(`/api/reportes/boleta-pdf/${ctx.al2}`).set(auth(ctx.tokens.alumno1));
  assert.equal(boleta.status, 403);
});

test("un padre solo consulta alumnos vinculados", async () => {
  const hijo = await request(app).get(`/api/alumnos/${ctx.al1}`).set(auth(ctx.tokens.padre1));
  assert.equal(hijo.status, 200);

  const ajeno = await request(app).get(`/api/alumnos/${ctx.al2}`).set(auth(ctx.tokens.padre1));
  assert.equal(ajeno.status, 403);

  const boleta = await request(app).get(`/api/reportes/boleta-pdf/${ctx.al2}`).set(auth(ctx.tokens.padre1));
  assert.equal(boleta.status, 403);

  const pago = await request(app).post("/api/pagos/checkout").set(auth(ctx.tokens.padre1))
    .send({ alumnoId: ctx.al2, concepto: "Colegiatura", monto: 100 });
  assert.equal(pago.status, 403);
});

test("un catedrático solo accede a sus secciones", async () => {
  const lista = await request(app).get("/api/alumnos").set(auth(ctx.tokens.cat1));
  assert.deepEqual(lista.body.map(a => a.id), [ctx.al1]);

  const ajeno = await request(app).get(`/api/alumnos/${ctx.al2}`).set(auth(ctx.tokens.cat1));
  assert.equal(ajeno.status, 403);

  const notaEnCursoAjeno = await request(app).post("/api/notas").set(auth(ctx.tokens.cat1))
    .send({ alumnoId: ctx.al2, cursoId: ctx.c2, valor: 80 });
  assert.equal(notaEnCursoAjeno.status, 403);

  const reporteAjeno = await request(app)
    .get(`/api/reportes/notas-por-catedratico/${ctx.cat2}`).set(auth(ctx.tokens.cat1));
  assert.equal(reporteAjeno.status, 403);
});

test("un usuario no puede elevarse de rol", async () => {
  const sinToken = await request(app).post("/api/auth/signup")
    .send({ username: "x", email: "x@x.com", password: PASSWORD, rol: "admin" });
  assert.equal(sinToken.status, 403);

  const comoAlumno = await request(app).post("/api/auth/signup").set(auth(ctx.tokens.alumno1))
    .send({ username: "x", email: "x@x.com", password: PASSWORD, rol: "admin" });
  assert.equal(comoAlumno.status, 403);

  const editar = await request(app).put(`/api/usuarios/${ctx.usuarioAlumno1}`).set(auth(ctx.tokens.alumno1))
    .send({ rol: "admin" });
  assert.equal(editar.status, 403);

  const usuario = await db.usuarios.findByPk(ctx.usuarioAlumno1);
  assert.equal(usuario.rol, "alumno");
});

test("signup exige contraseña de mínimo 8 caracteres", async () => {
  const res = await request(app).post("/api/auth/signup").set(auth(ctx.tokens.admin))
    .send({ username: "corta", email: "corta@x.com", password: "123", rol: "alumno" });
  assert.equal(res.status, 400);
});

test("no se puede inscribir un alumno en un curso de otra carrera", async () => {
  const res = await request(app).post("/api/asignaciones-curso").set(auth(ctx.tokens.admin))
    .send({ alumnoId: ctx.al1, cursoId: ctx.c3, periodo: "2026" });
  assert.equal(res.status, 400);
});

test("se detectan cruces de horario al inscribir", async () => {
  // alumno1 ya cursa C1 (Lunes 08-10); C2 es Lunes 09-11.
  const cruce = await request(app).post("/api/asignaciones-curso").set(auth(ctx.tokens.admin))
    .send({ alumnoId: ctx.al1, cursoId: ctx.c2, periodo: "2026" });
  assert.equal(cruce.status, 409);

  const sinCruce = await request(app).post("/api/asignaciones-curso").set(auth(ctx.tokens.admin))
    .send({ alumnoId: ctx.al1, cursoId: ctx.c4, periodo: "2026" });
  assert.equal(sinCruce.status, 200);

  const duplicada = await request(app).post("/api/asignaciones-curso").set(auth(ctx.tokens.admin))
    .send({ alumnoId: ctx.al1, cursoId: ctx.c4, periodo: "2026" });
  assert.equal(duplicada.status, 409);
});

test("se validan horarios de catedráticos", async () => {
  const cruce = await request(app).post("/api/horarios-catedratico").set(auth(ctx.tokens.admin))
    .send({ catedraticoId: ctx.cat1, cursoId: ctx.c4, dia: "Lunes", horaInicio: "09:00", horaFin: "11:00" });
  assert.equal(cruce.status, 409);

  const invertido = await request(app).post("/api/horarios-catedratico").set(auth(ctx.tokens.admin))
    .send({ catedraticoId: ctx.cat1, cursoId: ctx.c4, dia: "Jueves", horaInicio: "11:00", horaFin: "09:00" });
  assert.equal(invertido.status, 400);

  const formato = await request(app).post("/api/horarios-catedratico").set(auth(ctx.tokens.admin))
    .send({ catedraticoId: ctx.cat1, cursoId: ctx.c4, dia: "Jueves", horaInicio: "8am", horaFin: "9am" });
  assert.equal(formato.status, 400);

  const valido = await request(app).post("/api/horarios-catedratico").set(auth(ctx.tokens.admin))
    .send({ catedraticoId: ctx.cat1, cursoId: ctx.c4, dia: "Jueves", horaInicio: "10:00", horaFin: "12:00" });
  assert.equal(valido.status, 201);
});

test("límites de notas: 0, 60, 61 y 100 válidos; fuera de rango o no numéricas rechazadas", async () => {
  const registrar = valor => request(app).post("/api/notas").set(auth(ctx.tokens.cat1))
    .send({ alumnoId: ctx.al1, cursoId: ctx.c1, valor, periodo: "2026" });

  for (const invalido of [-1, 101, "abc", null, 100.5]) {
    assert.equal((await registrar(invalido)).status, 400, `valor ${invalido}`);
  }

  const creada = await registrar(60);
  assert.equal(creada.status, 200);
  assert.equal(creada.body.estado, "reprobado");

  assert.equal((await registrar(70)).status, 409);

  const actualizar = valor => request(app).put(`/api/notas/${creada.body.id}`).set(auth(ctx.tokens.cat1))
    .send({ valor });
  assert.equal((await actualizar(61)).body.nota.estado, "aprobado");
  assert.equal((await actualizar(100)).body.nota.estado, "aprobado");
  assert.equal((await actualizar(0)).body.nota.estado, "reprobado");
  assert.equal((await actualizar(101)).status, 400);
  assert.equal((await actualizar("x")).status, 400);

  const otroCat = await request(app).put(`/api/notas/${creada.body.id}`).set(auth(ctx.tokens.cat2))
    .send({ valor: 90 });
  assert.equal(otroCat.status, 403);
});

test("el login responde igual para usuario inexistente y contraseña incorrecta", async () => {
  const inexistente = await login("no-existe", "cualquiera123");
  const incorrecta = await login("alumno1", "otraClave123");
  assert.equal(inexistente.status, 401);
  assert.equal(incorrecta.status, 401);
  assert.deepEqual(inexistente.body, incorrecta.body);
});

function firmar(payload) {
  const body = JSON.stringify(payload);
  const header = Stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: process.env.STRIPE_WEBHOOK_SECRET
  });
  return { body, header };
}

test("webhook rechaza firma inválida o ausente", async () => {
  const pago = await db.pagos.create({
    alumnoId: ctx.al1, concepto: "Colegiatura", monto: 100, stripeSessionId: "cs_firma"
  });
  const evento = {
    id: "evt_1", object: "event", type: "checkout.session.completed",
    data: { object: { id: "cs_firma", payment_status: "paid", metadata: { pagoId: String(pago.id) } } }
  };

  const sinFirma = await request(app).post("/api/pagos/webhook")
    .set("Content-Type", "application/json").send(JSON.stringify(evento));
  assert.equal(sinFirma.status, 400);

  const falsa = await request(app).post("/api/pagos/webhook")
    .set("Content-Type", "application/json")
    .set("Stripe-Signature", "t=1,v1=firmafalsa")
    .send(JSON.stringify(evento));
  assert.equal(falsa.status, 400);

  await pago.reload();
  assert.equal(pago.estado, "pendiente");
});

test("webhook es idempotente ante eventos repetidos", async () => {
  const pago = await db.pagos.create({
    alumnoId: ctx.al1, concepto: "Colegiatura", monto: 100, stripeSessionId: "cs_idem"
  });
  const { body, header } = firmar({
    id: "evt_2", object: "event", type: "checkout.session.completed",
    data: { object: { id: "cs_idem", payment_status: "paid", metadata: { pagoId: String(pago.id) } } }
  });
  const enviar = () => request(app).post("/api/pagos/webhook")
    .set("Content-Type", "application/json").set("Stripe-Signature", header).send(body);

  assert.equal((await enviar()).status, 200);
  await pago.reload();
  assert.equal(pago.estado, "pagado");
  const primeraFecha = pago.fechaPago.getTime();

  assert.equal((await enviar()).status, 200);
  await pago.reload();
  assert.equal(pago.estado, "pagado");
  assert.equal(pago.fechaPago.getTime(), primeraFecha);
});

test("webhook no marca como pagado si Stripe no confirma el cobro y cancela sesiones expiradas", async () => {
  const noPagado = await db.pagos.create({
    alumnoId: ctx.al1, concepto: "Carnet", monto: 10, stripeSessionId: "cs_unpaid"
  });
  const a = firmar({
    id: "evt_3", object: "event", type: "checkout.session.completed",
    data: { object: { id: "cs_unpaid", payment_status: "unpaid", metadata: { pagoId: String(noPagado.id) } } }
  });
  await request(app).post("/api/pagos/webhook")
    .set("Content-Type", "application/json").set("Stripe-Signature", a.header).send(a.body);
  await noPagado.reload();
  assert.equal(noPagado.estado, "pendiente");

  const expirado = await db.pagos.create({
    alumnoId: ctx.al1, concepto: "Carnet", monto: 10, stripeSessionId: "cs_exp"
  });
  const b = firmar({
    id: "evt_4", object: "event", type: "checkout.session.expired",
    data: { object: { id: "cs_exp", metadata: { pagoId: String(expirado.id) } } }
  });
  await request(app).post("/api/pagos/webhook")
    .set("Content-Type", "application/json").set("Stripe-Signature", b.header).send(b.body);
  await expirado.reload();
  assert.equal(expirado.estado, "cancelado");
});

test("los logs no contienen contraseñas ni tokens", async () => {
  await login("alumno1", "ContraseñaSecreta999");
  await request(app).post("/api/auth/signin").set("Content-Type", "application/json").send("{malformado");
  const salida = logs.join("\n");
  assert.ok(!salida.includes("ContraseñaSecreta999"));
  assert.ok(!salida.includes(PASSWORD));
  assert.ok(!salida.includes(ctx.tokens.alumno1));
});
