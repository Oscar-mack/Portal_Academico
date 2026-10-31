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
  const ready = await request(app).get("/ready");
  assert.equal(ready.status, 200);
  assert.deepEqual(ready.body.checks, { database: "ok", schema: "ok" });
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

  const cargoAjeno = await db.cargos.create({
    alumnoId: ctx.al2,
    concepto: "Colegiatura",
    montoOriginal: "100.00",
    moneda: "GTQ",
    fechaEmision: "2026-01-01"
  });
  const pago = await request(app).post("/api/pagos/checkout").set(auth(ctx.tokens.padre1))
    .send({ cargoId: cargoAjeno.id });
  assert.equal(pago.status, 403);
});

test("mis-alumnos y dashboard se limitan a los perfiles autorizados", async () => {
  const misAlumnos = await request(app).get("/api/padres-alumnos/mis-alumnos")
    .set(auth(ctx.tokens.padre1));
  assert.equal(misAlumnos.status, 200);
  assert.deepEqual(misAlumnos.body.map(vinculo => vinculo.alumno.id), [ctx.al1]);

  const dashboardPadre = await request(app).get("/api/dashboard")
    .set(auth(ctx.tokens.padre1));
  assert.equal(dashboardPadre.status, 200);
  assert.deepEqual(dashboardPadre.body.alumnos.map(resumen => resumen.alumno.id), [ctx.al1]);

  const dashboardAlumno = await request(app).get("/api/dashboard")
    .set(auth(ctx.tokens.alumno1));
  assert.equal(dashboardAlumno.status, 200);
  assert.equal(dashboardAlumno.body.alumno.id, ctx.al1);

  const dashboardDocente = await request(app).get("/api/dashboard")
    .set(auth(ctx.tokens.cat1));
  assert.equal(dashboardDocente.status, 200);
  assert.equal(dashboardDocente.body.resumen.cursosAsignados, 1);

  const dashboardAdmin = await request(app).get("/api/dashboard")
    .set(auth(ctx.tokens.admin));
  assert.equal(dashboardAdmin.status, 200);
  assert.equal(dashboardAdmin.body.resumen.alumnosActivos, 2);
});

test("configuración de documentos de solvencia solo la administra un administrador", async () => {
  const creado = await request(app).post("/api/requisitos-solvencia")
    .set(auth(ctx.tokens.admin))
    .send({ tipoDocumento: "Constancia de estudios", requiereSolvencia: true });
  assert.equal(creado.status, 201);

  const listado = await request(app).get("/api/requisitos-solvencia")
    .set(auth(ctx.tokens.alumno1));
  assert.equal(listado.status, 200);
  assert.equal(listado.body[0].requiereSolvencia, true);

  const prohibido = await request(app).put(`/api/requisitos-solvencia/${creado.body.id}`)
    .set(auth(ctx.tokens.padre1))
    .send({ requiereSolvencia: false });
  assert.equal(prohibido.status, 403);
});

test("los horarios se limitan a cursos autorizados por rol", async () => {
  const admin = await request(app).get("/api/horarios-catedratico").set(auth(ctx.tokens.admin));
  assert.equal(admin.status, 200);
  assert.ok(admin.body.length >= 3);

  const catedratico = await request(app).get("/api/horarios-catedratico")
    .set(auth(ctx.tokens.cat1));
  assert.equal(catedratico.status, 200);
  assert.ok(catedratico.body.every(horario => horario.catedraticoId === ctx.cat1));

  const cursoAjeno = await request(app).get(`/api/horarios-catedratico?cursoId=${ctx.c2}`)
    .set(auth(ctx.tokens.cat1));
  assert.deepEqual(cursoAjeno.body, []);

  const alumno = await request(app).get("/api/horarios-catedratico")
    .set(auth(ctx.tokens.alumno1));
  assert.equal(alumno.status, 200);
  assert.ok(alumno.body.every(horario => horario.cursoId === ctx.c1));

  const padre = await request(app).get("/api/horarios-catedratico")
    .set(auth(ctx.tokens.padre1));
  assert.equal(padre.status, 200);
  assert.ok(padre.body.every(horario => horario.cursoId === ctx.c1));

  const hijoNoVinculado = await request(app)
    .get(`/api/horarios-catedratico?alumnoId=${ctx.al2}`)
    .set(auth(ctx.tokens.padre1));
  assert.equal(hijoNoVinculado.status, 403);

  const horarioDeOtro = admin.body.find(horario => horario.cursoId === ctx.c2);
  const horarioAjeno = await request(app).get(`/api/horarios-catedratico/${horarioDeOtro.id}`)
    .set(auth(ctx.tokens.cat1));
  assert.equal(horarioAjeno.status, 403);
});

test("un padre no puede solicitar notas de un alumno no vinculado", async () => {
  const ajeno = await request(app)
    .get(`/api/notas?alumnoId=${ctx.al2}`)
    .set(auth(ctx.tokens.padre1));
  assert.equal(ajeno.status, 403);
});

test("alumnos y padres solo reciben notas publicadas", async () => {
  const nota = await db.notas.create({
    alumnoId: ctx.al1,
    cursoId: ctx.c1,
    catedraticoId: ctx.cat1,
    valor: 85,
    periodo: "2026-publicacion"
  });

  const alumnoAntes = await request(app).get(`/api/notas?periodo=${nota.periodo}`)
    .set(auth(ctx.tokens.alumno1));
  assert.deepEqual(alumnoAntes.body, []);
  const padreAntes = await request(app).get(`/api/notas?periodo=${nota.periodo}`)
    .set(auth(ctx.tokens.padre1));
  assert.deepEqual(padreAntes.body, []);

  const publicar = await request(app).patch(`/api/notas/${nota.id}/publicar`)
    .set(auth(ctx.tokens.cat1));
  assert.equal(publicar.status, 200);

  const alumnoDespues = await request(app).get(`/api/notas?periodo=${nota.periodo}`)
    .set(auth(ctx.tokens.alumno1));
  assert.deepEqual(alumnoDespues.body.map(registro => registro.id), [nota.id]);
  const padreDespues = await request(app).get(`/api/notas?periodo=${nota.periodo}`)
    .set(auth(ctx.tokens.padre1));
  assert.deepEqual(padreDespues.body.map(registro => registro.id), [nota.id]);
});

test("modificar una nota publicada exige motivo de al menos 10 caracteres", async () => {
  const nota = await db.notas.create({
    alumnoId: ctx.al1,
    cursoId: ctx.c1,
    catedraticoId: ctx.cat1,
    valor: 60,
    periodo: "2026-motivo"
  });
  const put = () => request(app).put(`/api/notas/${nota.id}`)
    .set(auth(ctx.tokens.cat1));

  // Sin publicar: no se exige motivo.
  assert.equal((await put().send({ valor: 61 })).status, 200);
  assert.equal((await request(app).patch(`/api/notas/${nota.id}/publicar`)
    .set(auth(ctx.tokens.cat1))).status, 200);

  for (const motivo of [undefined, "", "   ", "corto"]) {
    assert.equal((await put().send({ valor: 70, motivo })).status, 400);
  }
  assert.equal(Number((await db.notas.findByPk(nota.id)).valor), 61);
  assert.equal(await db.auditoriaNotas.count({ where: { notaId: nota.id } }), 1);

  const ok = await put().send({ valor: 70, motivo: "Error de captura en acta" });
  assert.equal(ok.status, 200);
  const auditorias = await db.auditoriaNotas.findAll({ where: { notaId: nota.id }, order: [["id", "ASC"]] });
  assert.equal(auditorias.length, 2);
  assert.equal(Number(auditorias[1].valorAnterior), 61);
  assert.equal(Number(auditorias[1].valorNuevo), 70);
  assert.equal(auditorias[1].motivo, "Error de captura en acta");
});

test("períodos y evaluaciones calculan notas finales sin alterar períodos históricos", async () => {
  const historica = await db.notas.create({
    alumnoId: ctx.al1,
    cursoId: ctx.c1,
    catedraticoId: ctx.cat1,
    valor: 72,
    periodo: "2025"
  });
  const ciclo = await request(app).post("/api/ciclos").set(auth(ctx.tokens.admin))
    .send({ nombre: "Ciclo de pruebas", fechaInicio: "2026-01-01", fechaFin: "2026-12-31" });
  assert.equal(ciclo.status, 201);
  const periodo = await request(app).post("/api/periodos").set(auth(ctx.tokens.admin))
    .send({
      cicloAcademicoId: ciclo.body.id,
      nombre: "Primer bimestre",
      tipo: "bimestre",
      fechaInicio: "2026-01-01",
      fechaFin: "2026-03-31"
    });
  assert.equal(periodo.status, 201);
    const traslapado = await request(app).post("/api/periodos").set(auth(ctx.tokens.admin))
      .send({
        cicloAcademicoId: ciclo.body.id,
        nombre: "Período traslapado",
        tipo: "bimestre",
        fechaInicio: "2026-03-01",
        fechaFin: "2026-04-30"
      });
    assert.equal(traslapado.status, 409);
    assert.equal((await request(app).put(`/api/ciclos/${ciclo.body.id}`)
      .set(auth(ctx.tokens.admin)).send({ fechaFin: "2026-03-30" })).status, 409);

  const horario = await request(app).post("/api/horarios-catedratico").set(auth(ctx.tokens.admin))
    .send({
      catedraticoId: ctx.cat1,
      cursoId: ctx.c1,
      dia: "Viernes",
      horaInicio: "08:00",
      horaFin: "09:00",
      periodoAcademicoId: periodo.body.id
    });
  assert.equal(horario.status, 201);
  const inscripcion = await request(app).post("/api/asignaciones-curso").set(auth(ctx.tokens.admin))
    .send({ alumnoId: ctx.al1, cursoId: ctx.c1, periodoAcademicoId: periodo.body.id });
  assert.equal(inscripcion.status, 200);

  const crearEvaluacion = (nombre, puntajeMaximo) => request(app).post("/api/evaluaciones")
    .set(auth(ctx.tokens.cat1))
    .send({ cursoId: ctx.c1, periodoAcademicoId: periodo.body.id, nombre, puntajeMaximo });
  const tarea = await crearEvaluacion("Tareas", 40);
  const examen = await crearEvaluacion("Examen", 60);
  assert.equal(tarea.status, 201, JSON.stringify(tarea.body));
  assert.equal(examen.status, 201, JSON.stringify(examen.body));
  assert.equal((await crearEvaluacion("Extra", 1)).status, 409);

  const evaluacionesAlumno = await request(app)
    .get(`/api/evaluaciones?cursoId=${ctx.c1}&periodoAcademicoId=${periodo.body.id}`)
    .set(auth(ctx.tokens.alumno1));
  assert.equal(evaluacionesAlumno.status, 200);
  assert.equal(evaluacionesAlumno.body.length, 2);
  assert.ok(evaluacionesAlumno.body.every(item =>
    item.curso.id === ctx.c1 &&
    item.calificaciones.length === 0
  ));
  const evaluacionesOtroAlumno = await request(app)
    .get("/api/evaluaciones")
    .set(auth(ctx.tokens.alumno2));
  assert.equal(evaluacionesOtroAlumno.status, 200);
  assert.deepEqual(evaluacionesOtroAlumno.body, []);
  assert.equal((await request(app).get("/api/evaluaciones")
    .set(auth(ctx.tokens.padre1))).status, 403);
  assert.equal((await request(app).get(`/api/evaluaciones/${tarea.body.id}/calificaciones`)
    .set(auth(ctx.tokens.alumno1))).status, 403);

  const registrar = (evaluacionId, valor, motivo) => request(app)
    .post(`/api/evaluaciones/${evaluacionId}/calificaciones`)
    .set(auth(ctx.tokens.cat1))
    .send({ alumnoId: ctx.al1, valor, motivo });
  const sobreMaximo = await registrar(tarea.body.id, 41);
  assert.equal(sobreMaximo.status, 400);
  assert.equal((await registrar(tarea.body.id, 35)).body.consolidada, false);
  const finalResponse = await registrar(examen.body.id, 50);
  assert.equal(finalResponse.status, 200);
  assert.equal(finalResponse.body.notaFinal.valor, 85);
  assert.equal(finalResponse.body.notaFinal.estado, "aprobado");
  const evaluacionesCalificadas = await request(app)
    .get(`/api/evaluaciones?periodoAcademicoId=${periodo.body.id}`)
    .set(auth(ctx.tokens.alumno1));
  assert.ok(evaluacionesCalificadas.body.every(item =>
    item.calificaciones.length === 1 &&
    item.calificaciones[0].valor !== undefined
  ));
  const borrarInscripcion = await request(app).delete(`/api/asignaciones-curso/${inscripcion.body.id}`)
    .set(auth(ctx.tokens.admin));
  assert.equal(borrarInscripcion.status, 409);

  const notasAntesPublicar = await request(app)
    .get(`/api/notas?periodoAcademicoId=${periodo.body.id}`)
    .set(auth(ctx.tokens.alumno1));
  assert.deepEqual(notasAntesPublicar.body, []);
  const publicar = await request(app)
    .patch(`/api/notas/${finalResponse.body.notaFinal.id}/publicar`)
    .set(auth(ctx.tokens.cat1));
  assert.equal(publicar.status, 200);
  assert.equal((await request(app).get(`/api/notas?periodoAcademicoId=${periodo.body.id}`)
    .set(auth(ctx.tokens.alumno1))).body[0].valor, 85);
  assert.equal((await request(app).put(`/api/notas/${finalResponse.body.notaFinal.id}`)
    .set(auth(ctx.tokens.admin)).send({ valor: 99 })).status, 409);
  assert.equal((await request(app).put(`/api/evaluaciones/${examen.body.id}`)
    .set(auth(ctx.tokens.admin)).send({ nombre: "Examen editado" })).status, 409);

  for (const motivoInvalido of [undefined, "", "   corto   ", "123456789"]) {
    const rechazada = await registrar(examen.body.id, 51, motivoInvalido);
    assert.equal(rechazada.status, 400, JSON.stringify(rechazada.body));
  }
  const intacta = await db.notas.findByPk(finalResponse.body.notaFinal.id);
  assert.equal(Number(intacta.valor), 85);
  assert.ok(intacta.publicadaEn);
  assert.equal(Number((await db.calificacionesEvaluacion.findOne({
    where: { evaluacionId: examen.body.id, alumnoId: ctx.al1 }
  })).valor), 50);
  assert.equal(await db.auditoriaNotas.count({ where: { notaId: intacta.id } }), 0);
  // Reenviar el mismo valor no modifica la nota y no exige motivo.
  assert.equal((await registrar(examen.body.id, 50)).status, 200);

  const corregida = await registrar(examen.body.id, 51, "Corrección de evaluación");
  assert.equal(corregida.body.notaFinal.valor, 86);
  assert.equal(corregida.body.notaFinal.publicadaEn, null);
  const historial = await request(app)
    .get(`/api/notas/${finalResponse.body.notaFinal.id}/historial`)
    .set(auth(ctx.tokens.cat1));
  assert.equal(historial.status, 200);
  assert.equal(historial.body.length, 1);
  assert.equal(Number(historial.body[0].valorAnterior), 85);
  assert.equal(Number(historial.body[0].valorNuevo), 86);
  assert.equal((await db.notas.findByPk(historica.id)).periodoAcademicoId, null);

  assert.equal((await request(app).put(`/api/periodos/${periodo.body.id}`)
    .set(auth(ctx.tokens.admin)).send({ estado: "cerrado" })).status, 200);
  assert.equal((await registrar(examen.body.id, 52)).status, 409);
  assert.equal((await request(app).delete(`/api/horarios-catedratico/${horario.body.id}`)
    .set(auth(ctx.tokens.admin))).status, 409);
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
  const asignacion = await db.asignacionesCurso.findOne({
    where: { alumnoId: ctx.al1, cursoId: ctx.c1, periodo: "2026" }
  });
  const cambioInvalido = await request(app).put(`/api/asignaciones-curso/${asignacion.id}`)
    .set(auth(ctx.tokens.admin)).send({ cursoId: ctx.c3 });
  assert.equal(cambioInvalido.status, 400);
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
  const cruceAlEditar = await request(app).put(`/api/horarios-catedratico/${valido.body.id}`)
    .set(auth(ctx.tokens.admin)).send({ dia: "Lunes", horaInicio: "09:00", horaFin: "11:00" });
  assert.equal(cruceAlEditar.status, 409);
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

test("los abonos confirmados actualizan saldo y solvencia; webhooks persistentes son idempotentes", async () => {
  const cargo = await request(app).post("/api/cargos").set(auth(ctx.tokens.admin))
    .send({
      alumnoId: ctx.al1,
      concepto: "Colegiatura de prueba",
      montoOriginal: 350,
      moneda: "GTQ",
      fechaEmision: "2026-10-01",
      fechaVencimiento: "2026-10-31"
    });
  assert.equal(cargo.status, 201);
  const pagoHistorico = await db.pagos.create({
    alumnoId: ctx.al1,
    concepto: "Pago histórico sin cargo",
    monto: "30.00",
    moneda: "gtq",
    estado: "pagado",
    fechaPago: new Date()
  });
  await pagoHistorico.reload();
  assert.equal(pagoHistorico.cargoId, null);
    const saldoDemasiadoAlto = await request(app).post("/api/pagos/checkout")
      .set(auth(ctx.tokens.alumno1))
      .send({ cargoId: cargo.body.id, monto: 350.01 });
    assert.equal(saldoDemasiadoAlto.status, 400);
    const montoClienteAntiguo = await request(app).post("/api/pagos/checkout")
      .set(auth(ctx.tokens.alumno1))
      .send({ alumnoId: ctx.al1, concepto: "Importe manipulado", monto: 1 });
    assert.equal(montoClienteAntiguo.status, 400);

  const crearPago = async (monto, sessionId) => db.pagos.create({
    alumnoId: ctx.al1,
    cargoId: cargo.body.id,
    concepto: cargo.body.concepto,
    monto: monto.toFixed(2),
    moneda: "gtq",
    estado: "pendiente",
    stripeSessionId: sessionId
  });
  const notificar = async (pago, eventId, amount) => {
    const firmado = firmar({
      id: eventId,
      object: "event",
      type: "checkout.session.completed",
      data: { object: {
        id: pago.stripeSessionId,
        payment_status: "paid",
        amount_total: amount * 100,
        currency: "gtq",
        metadata: { pagoId: String(pago.id), cargoId: String(cargo.body.id) }
      } }
    });
    return request(app).post("/api/pagos/webhook")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", firmado.header)
      .send(firmado.body);
  };

  const primerAbono = await crearPago(150, "cs-abono-1");
  assert.equal((await notificar(primerAbono, "evt-abono-1", 150)).status, 200);
  const saldoParcial = await request(app).get(`/api/cargos?alumnoId=${ctx.al1}`)
    .set(auth(ctx.tokens.alumno1));
  assert.equal(saldoParcial.body[0].estado, "parcial");
  assert.equal(saldoParcial.body[0].saldoPendiente, 200);
  const solvenciaParcial = await request(app).get(`/api/cargos/solvencia?alumnoId=${ctx.al1}`)
    .set(auth(ctx.tokens.alumno1));
  assert.equal(solvenciaParcial.body.solvente, false);
  assert.equal(solvenciaParcial.body.conciliacionHistoricaRequerida, true);
  assert.equal(solvenciaParcial.body.saldoPendiente, 200);

  const segundoAbono = await crearPago(200, "cs-abono-2");
  const webhookCompleto = await notificar(segundoAbono, "evt-abono-2", 200);
  assert.equal(webhookCompleto.status, 200);
  assert.equal((await notificar(segundoAbono, "evt-abono-2", 200)).body.duplicate, true);
  const saldoFinal = await request(app).get(`/api/cargos?alumnoId=${ctx.al1}`)
    .set(auth(ctx.tokens.alumno1));
  assert.equal(saldoFinal.body[0].estado, "pagado");
  assert.equal(saldoFinal.body[0].saldoPendiente, 0);
  assert.equal(saldoFinal.body[0].pagos.length, 2);
  const solvenciaFinal = await request(app).get(`/api/cargos/solvencia?alumnoId=${ctx.al1}`)
    .set(auth(ctx.tokens.alumno1));
  assert.equal(solvenciaFinal.body.solvente, false);
  assert.equal(solvenciaFinal.body.conciliacionHistoricaRequerida, true);
  assert.equal(solvenciaFinal.body.saldoPendiente, 0);
  assert.equal(await db.eventosStripe.count({ where: { stripeEventId: "evt-abono-2" } }), 1);

  const cargoFallido = await db.cargos.create({
    alumnoId: ctx.al1,
    concepto: "Cargo con intento fallido",
    montoOriginal: "20.00",
    moneda: "GTQ",
    fechaEmision: "2026-10-01"
  });
  const pagoFallido = await db.pagos.create({
    alumnoId: ctx.al1,
    cargoId: cargoFallido.id,
    concepto: cargoFallido.concepto,
    monto: "20.00",
    moneda: "gtq",
    estado: "pendiente",
    stripeSessionId: "cs-abono-fallido"
  });
  const intentoFallido = firmar({
    id: "evt-abono-fallido",
    object: "event",
    type: "checkout.session.async_payment_failed",
    data: { object: {
      id: pagoFallido.stripeSessionId,
      metadata: { pagoId: String(pagoFallido.id), cargoId: String(cargoFallido.id) }
    } }
  });
  assert.equal((await request(app).post("/api/pagos/webhook")
    .set("Content-Type", "application/json")
    .set("Stripe-Signature", intentoFallido.header)
    .send(intentoFallido.body)).status, 200);
  await pagoFallido.reload();
  assert.equal(pagoFallido.estado, "fallido");
  const saldoCargoFallido = await request(app).get(`/api/cargos?alumnoId=${ctx.al1}`)
    .set(auth(ctx.tokens.alumno1));
  const detalleFallido = saldoCargoFallido.body.find(item => item.id === cargoFallido.id);
  assert.equal(detalleFallido.saldoPendiente, 20);
  await db.cargos.create({
    alumnoId: ctx.al1,
    concepto: "Cargo en dólares",
    montoOriginal: "25.00",
    moneda: "USD",
    fechaEmision: "2026-10-01"
  });
  const solvenciaMixta = await request(app).get(`/api/cargos/solvencia?alumnoId=${ctx.al1}`)
    .set(auth(ctx.tokens.alumno1));
  assert.equal(solvenciaMixta.body.saldoPendiente, null);
  assert.deepEqual(solvenciaMixta.body.saldoPendientePorMoneda, { GTQ: 20, USD: 25 });

  const solvenciaHistorica = await request(app)
    .get(`/api/cargos/solvencia?alumnoId=${ctx.al1}`)
    .set(auth(ctx.tokens.alumno1));
  assert.equal(solvenciaHistorica.body.conciliacionHistoricaRequerida, true);
  assert.equal(solvenciaHistorica.body.solvente, false);
  assert.ok(solvenciaHistorica.body.pagosHistoricosSinCargo.GTQ.montoPagado >= 30);

  const estadoCuenta = await request(app)
    .get(`/api/reportes/estado-cuenta-pdf/${ctx.al1}`)
    .set(auth(ctx.tokens.padre1));
  assert.equal(estadoCuenta.status, 200);
  assert.match(estadoCuenta.headers["content-type"], /application\/pdf/);
  assert.equal(estadoCuenta.body.subarray(0, 4).toString(), "%PDF");
  assert.equal((await request(app)
    .get(`/api/reportes/estado-cuenta-pdf/${ctx.al2}`)
    .set(auth(ctx.tokens.padre1))).status, 403);
});

test("los logs no contienen contraseñas ni tokens", async () => {
  await login("alumno1", "ContraseñaSecreta999");
  await request(app).post("/api/auth/signin").set("Content-Type", "application/json").send("{malformado");
  const salida = logs.join("\n");
  assert.ok(!salida.includes("ContraseñaSecreta999"));
  assert.ok(!salida.includes(PASSWORD));
  assert.ok(!salida.includes(ctx.tokens.alumno1));
});

test("readiness rechaza un esquema incompleto", async () => {
  await db.sequelize.getQueryInterface().dropTable("eventos_stripe");
  const ready = await request(app).get("/ready");
  assert.equal(ready.status, 503);
  assert.equal(ready.body.checks.database, "ok");
  assert.equal(ready.body.checks.schema, "incomplete");
  assert.ok(ready.body.missingSchema.includes("table:eventos_stripe"));
});
