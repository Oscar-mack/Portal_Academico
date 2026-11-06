process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "clave-de-pruebas-con-mas-de-32-caracteres";

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcryptjs");

const db = require("../app/models");
const app = require("../app");
const storage = require("../app/services/r2Storage.js");

const PASSWORD = "ClaveSegura123";
const ctx = { tokens: {} };
const objects = new Map();
const original = {
  ensureConfigured: storage.ensureConfigured,
  uploadObject: storage.uploadObject,
  removeObject: storage.removeObject,
  createDownloadUrl: storage.createDownloadUrl
};
const originalError = console.error;
const auth = token => ({ Authorization: `Bearer ${token}` });
const day = 24 * 60 * 60 * 1000;
const iso = offset => new Date(Date.now() + offset * day).toISOString();
const date = offset => iso(offset).slice(0, 10);
const pdf = (text = "contenido") => Buffer.from(`%PDF-1.7\n${text}`);

async function user(username, rol) {
  return db.usuarios.create({
    username, email: `${username}@prueba.edu`, password: bcrypt.hashSync(PASSWORD, 4), rol
  });
}

test.before(async () => {
  console.error = () => {};
  storage.ensureConfigured = () => {};
  storage.uploadObject = async (key, stream) => {
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    objects.set(key, Buffer.concat(chunks));
  };
  storage.removeObject = async key => objects.delete(key);
  storage.createDownloadUrl = async key => `https://private-bucket.invalid/${key}?signed=test`;

  await db.sequelize.sync({ force: true });
  const grado = await db.gradosCarreras.create({ nombre: "Ingeniería", descripcion: "A" });
  ctx.curso = (await db.cursos.create({ nombre: "Física", codigo: "FIS1", creditos: 4, gradoCarreraId: grado.id })).id;
  ctx.otroCurso = (await db.cursos.create({ nombre: "Química", codigo: "QUI1", creditos: 4, gradoCarreraId: grado.id })).id;
  const ciclo = await db.ciclosAcademicos.create({ nombre: "Ciclo actual", fechaInicio: date(-60), fechaFin: date(120) });
  ctx.periodo = (await db.periodosAcademicos.create({
    cicloAcademicoId: ciclo.id, nombre: "Período actual", tipo: "trimestre", fechaInicio: date(-30), fechaFin: date(90)
  })).id;

  await user("admin", "admin");
  const uDoc = await user("docente", "catedratico");
  const uDocAjeno = await user("docenteajeno", "catedratico");
  const uA1 = await user("alumno1", "alumno");
  const uA2 = await user("alumno2", "alumno");
  const uPadre = await user("padre", "padre");
  ctx.docente = (await db.catedraticos.create({ nombre: "Ana", apellido: "Uno", email: "ana@prueba.edu", usuarioId: uDoc.id })).id;
  await db.catedraticos.create({ nombre: "Beto", apellido: "Dos", email: "beto@prueba.edu", usuarioId: uDocAjeno.id });
  ctx.al1 = (await db.alumnos.create({ nombre: "Luis", apellido: "Uno", email: "luis@prueba.edu", gradoCarreraId: grado.id, usuarioId: uA1.id })).id;
  await db.alumnos.create({ nombre: "Mia", apellido: "Dos", email: "mia@prueba.edu", gradoCarreraId: grado.id, usuarioId: uA2.id });
  await db.padresAlumnos.create({ usuarioId: uPadre.id, alumnoId: ctx.al1 });
  await db.horariosCatedratico.create({
    catedraticoId: ctx.docente, cursoId: ctx.curso, dia: "Lunes", horaInicio: "08:00", horaFin: "09:00",
    periodo: "2026", periodoAcademicoId: ctx.periodo
  });
  await db.asignacionesCurso.create({ alumnoId: ctx.al1, cursoId: ctx.curso, periodoAcademicoId: ctx.periodo, periodo: "2026" });

  for (const name of ["admin", "docente", "docenteajeno", "alumno1", "alumno2", "padre"]) {
    const res = await request(app).post("/api/auth/signin").send({ username: name, password: PASSWORD });
    assert.equal(res.status, 200, `login de ${name}`);
    ctx.tokens[name] = res.body.token;
  }
});

test.after(async () => {
  console.error = originalError;
  Object.assign(storage, original);
  await db.sequelize.close();
});

async function newTask(titulo) {
  const res = await request(app).post("/api/tareas").set(auth(ctx.tokens.docente)).send({
    cursoId: ctx.curso,
    periodoAcademicoId: ctx.periodo,
    titulo,
    descripcion: "Descripción",
    instrucciones: "Instrucciones",
    fechaPublicacion: iso(-1),
    fechaLimite: iso(10)
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id;
}

const submit = (taskId, token, buffer = pdf(), filename = "entrega.pdf", contentType = "application/pdf") =>
  request(app).post(`/api/tareas/${taskId}/entregas`).set(auth(token)).attach("file", buffer, { filename, contentType });

test("entrega: éxito, duplicado, inválido, sin autorización y sin sesión", async () => {
  const taskId = await newTask("Informe");
  assert.equal((await request(app).post(`/api/tareas/${taskId}/entregas`)).status, 403, "sin token");
  assert.equal((await submit(taskId, ctx.tokens.padre)).status, 403);
  assert.equal((await submit(taskId, ctx.tokens.alumno2)).status, 403, "alumno no inscrito");
  assert.equal((await submit(taskId, ctx.tokens.alumno1, Buffer.from("MZ binario"), "malo.exe", "application/octet-stream")).status, 415);
  assert.equal((await submit(taskId, ctx.tokens.alumno1, Buffer.from("<script>"), "falso.pdf")).status, 415);
  assert.equal(await db.entregasTarea.count({ where: { tareaId: taskId } }), 0, "los rechazos no registran entrega");

  const ok = await submit(taskId, ctx.tokens.alumno1);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal("storageKey" in ok.body.archivo, false);
  const duplicate = await submit(taskId, ctx.tokens.alumno1, pdf("otro"), "segunda.pdf");
  assert.equal(duplicate.status, 409);
  assert.match(duplicate.body.message, /Ya registraste una entrega/);
  assert.equal(await db.entregasTarea.count({ where: { tareaId: taskId, alumnoId: ctx.al1 } }), 1);
  assert.equal(await db.archivosAcademicos.count(), (await db.entregasTarea.count()) + (await db.materialesCurso.count()) + (await db.adjuntosTarea.count()));

  const mine = await request(app).get(`/api/tareas?periodoAcademicoId=${ctx.periodo}`).set(auth(ctx.tokens.alumno1));
  assert.equal(mine.body.find(item => item.id === taskId).estadoEntrega, "entregada");
});

test("entrega: envíos simultáneos producen una sola entrega", async () => {
  const taskId = await newTask("Concurrente");
  const results = await Promise.all([
    submit(taskId, ctx.tokens.alumno1, pdf("a"), "a.pdf"),
    submit(taskId, ctx.tokens.alumno1, pdf("b"), "b.pdf")
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  assert.equal(await db.entregasTarea.count({ where: { tareaId: taskId } }), 1);
  assert.equal(objects.size, await db.archivosAcademicos.count(), "sin archivos huérfanos en el almacenamiento");
});

test("entrega: fallo del almacenamiento responde 503 y no deja registros", async () => {
  const taskId = await newTask("Almacenamiento caído");
  const upload = storage.uploadObject;
  storage.uploadObject = async (key, stream) => {
    stream.resume();
    throw Object.assign(new Error("El almacenamiento académico no está disponible."), { status: 503 });
  };
  try {
    const res = await submit(taskId, ctx.tokens.alumno1);
    assert.equal(res.status, 503);
    assert.match(res.body.message, /almacenamiento académico/);
  } finally {
    storage.uploadObject = upload;
  }
  assert.equal(await db.entregasTarea.count({ where: { tareaId: taskId } }), 0);
  const retry = await submit(taskId, ctx.tokens.alumno1);
  assert.equal(retry.status, 201, "tras el fallo la entrega puede reintentarse");
});

test("entrega: archivo demasiado grande responde 413 sin registrar", async () => {
  const taskId = await newTask("Grande");
  const big = Buffer.alloc(20 * 1024 * 1024 + 1);
  big.write("%PDF-1.7\n");
  assert.equal((await submit(taskId, ctx.tokens.alumno1, big)).status, 413);
  assert.equal(await db.entregasTarea.count({ where: { tareaId: taskId } }), 0);
});

test("flujo docente → almacenamiento → asignatura → alumno visualiza y descarga; otros cursos no", async () => {
  const publish = (token, cursoId = ctx.curso) => request(app)
    .post(`/api/materiales/cursos/${cursoId}?periodoAcademicoId=${ctx.periodo}`)
    .set(auth(token)).field("titulo", "Guía").field("descripcion", "Apoyo")
    .attach("file", pdf("guia"), { filename: "guia.pdf", contentType: "application/pdf" });

  assert.equal((await publish(ctx.tokens.docenteajeno)).status, 403, "docente sin asignación");
  assert.equal((await publish(ctx.tokens.alumno1)).status, 403, "un alumno no publica");
  assert.equal((await publish(ctx.tokens.docente, ctx.otroCurso)).status, 403, "curso no asignado");
  assert.equal(await db.materialesCurso.count(), 0);
  const before = objects.size;

  const created = await publish(ctx.tokens.docente);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(objects.size, before + 1);
  assert.equal((await request(app).delete(`/api/materiales/${created.body.id}`)
    .set(auth(ctx.tokens.docenteajeno))).status, 403, "otro docente no puede desactivar el material");
  const row = await db.materialesCurso.findByPk(created.body.id, { include: [{ model: db.archivosAcademicos, as: "archivo" }] });
  assert.equal(row.cursoId, ctx.curso);
  assert.equal(row.periodoAcademicoId, ctx.periodo);
  assert.ok(objects.has(row.archivo.storageKey));

  const visible = await request(app).get(`/api/materiales?periodoAcademicoId=${ctx.periodo}`).set(auth(ctx.tokens.alumno1));
  assert.deepEqual(visible.body.map(m => m.titulo), ["Guía"]);
  assert.equal(visible.body[0].archivo.nombreOriginal, "guia.pdf");
  assert.ok(visible.body[0].createdAt);
  assert.equal("storageKey" in visible.body[0].archivo, false);
  const download = await request(app).get(`/api/archivos-academicos/${created.body.archivo.id}/descarga`).set(auth(ctx.tokens.alumno1));
  assert.equal(download.status, 200);
  assert.match(download.body.url, /^https:\/\/private-bucket\.invalid\/materials\//);

  const other = await request(app).get(`/api/materiales?periodoAcademicoId=${ctx.periodo}`).set(auth(ctx.tokens.alumno2));
  assert.deepEqual(other.body, [], "alumno sin inscripción no ve materiales");
  assert.equal((await request(app).get(`/api/archivos-academicos/${created.body.archivo.id}/descarga`).set(auth(ctx.tokens.alumno2))).status, 403);
  assert.equal((await request(app).get(`/api/archivos-academicos/${created.body.archivo.id}/descarga`).set(auth(ctx.tokens.docenteajeno))).status, 403);
  assert.equal((await request(app).get(`/api/archivos-academicos/${created.body.archivo.id}/descarga`)).status, 403, "sin token");

  const updated = await request(app).put(`/api/materiales/${created.body.id}`)
    .set(auth(ctx.tokens.docente)).send({ titulo: "Guía actualizada", descripcion: "Revisada" });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.titulo, "Guía actualizada");
  assert.equal(updated.body.archivoId, created.body.archivo.id, "editar metadatos conserva el archivo asociado");
  assert.equal((await request(app).put(`/api/materiales/${created.body.id}`)
    .set(auth(ctx.tokens.docenteajeno)).send({ titulo: "Intrusión" })).status, 403);
  assert.equal((await request(app).put(`/api/materiales/${created.body.id}`)
    .set(auth(ctx.tokens.docente)).send({ titulo: "Inválido", archivoId: 99 })).status, 400);
  const updatedVisible = await request(app).get(`/api/materiales?cursoId=${ctx.curso}&periodoAcademicoId=${ctx.periodo}`)
    .set(auth(ctx.tokens.alumno1));
  assert.equal(updatedVisible.body[0].titulo, "Guía actualizada");
  assert.equal((await request(app).get(`/api/materiales?cursoId=${ctx.otroCurso}&periodoAcademicoId=${ctx.periodo}`)
    .set(auth(ctx.tokens.alumno1))).body.length, 0);

  const removed = await request(app).delete(`/api/materiales/${created.body.id}`).set(auth(ctx.tokens.docente));
  assert.equal(removed.status, 200);
  assert.deepEqual((await request(app).get(`/api/materiales?periodoAcademicoId=${ctx.periodo}`).set(auth(ctx.tokens.alumno1))).body, []);
  assert.equal((await request(app).get(`/api/archivos-academicos/${created.body.archivo.id}/descarga`).set(auth(ctx.tokens.alumno1))).status, 404);
});

test("descarga de material: archivo inexistente y firma del almacenamiento fallida", async () => {
  const missing = await request(app).get("/api/archivos-academicos/999999/descarga")
    .set(auth(ctx.tokens.alumno1));
  assert.equal(missing.status, 404);
  assert.match(missing.body.message, /Archivo no encontrado/);

  const created = await request(app)
    .post(`/api/materiales/cursos/${ctx.curso}?periodoAcademicoId=${ctx.periodo}`)
    .set(auth(ctx.tokens.docente))
    .field("titulo", "Material descarga")
    .attach("file", pdf(), { filename: "descarga.pdf", contentType: "application/pdf" });
  assert.equal(created.status, 201);
  const makeUrl = storage.createDownloadUrl;
  storage.createDownloadUrl = async () => {
    throw Object.assign(new Error("El almacenamiento académico no está disponible o devolvió una respuesta inesperada."), { status: 503 });
  };
  try {
    const failed = await request(app).get(`/api/archivos-academicos/${created.body.archivo.id}/descarga`)
      .set(auth(ctx.tokens.alumno1));
    assert.equal(failed.status, 503);
    assert.doesNotMatch(JSON.stringify(failed.body), /secret|unreachable/);
  } finally {
    storage.createDownloadUrl = makeUrl;
  }
});

test("material con almacenamiento caído responde 503 y no deja registros huérfanos", async () => {
  const upload = storage.uploadObject;
  storage.uploadObject = async (key, stream) => {
    stream.resume();
    throw Object.assign(new Error("El almacenamiento académico no está disponible."), { status: 503 });
  };
  const files = await db.archivosAcademicos.count();
  try {
    const res = await request(app)
      .post(`/api/materiales/cursos/${ctx.curso}?periodoAcademicoId=${ctx.periodo}`)
      .set(auth(ctx.tokens.docente)).field("titulo", "Caído")
      .attach("file", pdf(), { filename: "x.pdf", contentType: "application/pdf" });
    assert.equal(res.status, 503);
  } finally {
    storage.uploadObject = upload;
  }
  assert.equal(await db.archivosAcademicos.count(), files);
});

test("fallo al asociar un material revierte PostgreSQL y elimina el objeto subido", async () => {
  const uploadedBefore = objects.size;
  const filesBefore = await db.archivosAcademicos.count();
  const materialsBefore = await db.materialesCurso.count();
  const originalCreate = db.materialesCurso.create;
  db.materialesCurso.create = async () => { throw new Error("database write failed"); };
  try {
    const res = await request(app)
      .post(`/api/materiales/cursos/${ctx.curso}?periodoAcademicoId=${ctx.periodo}`)
      .set(auth(ctx.tokens.docente))
      .field("titulo", "Asociación fallida")
      .attach("file", pdf(), { filename: "rollback.pdf", contentType: "application/pdf" });
    assert.equal(res.status, 500);
    assert.doesNotMatch(JSON.stringify(res.body), /database write failed/);
  } finally {
    db.materialesCurso.create = originalCreate;
  }
  assert.equal(await db.archivosAcademicos.count(), filesBefore);
  assert.equal(await db.materialesCurso.count(), materialsBefore);
  assert.equal(objects.size, uploadedBefore);
});

test("caída de PostgreSQL durante la entrega responde 503 seguro sin filtrar detalles", async () => {
  const taskId = await newTask("BD caída");
  const logged = [];
  const spy = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  const original = db.entregasTarea.count;
  db.entregasTarea.count = async () => {
    throw Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432 password=secreto"), { name: "SequelizeConnectionRefusedError" });
  };
  try {
    const res = await submit(taskId, ctx.tokens.alumno1);
    assert.equal(res.status, 503);
    assert.match(res.body.message, /base de datos no está disponible/);
    assert.doesNotMatch(JSON.stringify(res.body) + logged.join(" "), /secreto|10\.0\.0\.1/);
  } finally {
    db.entregasTarea.count = original;
    console.error = spy;
  }
  assert.equal((await submit(taskId, ctx.tokens.alumno1)).status, 201, "se recupera al volver la base");
});

test("un error interno inesperado no expone su mensaje", async () => {
  const taskId = await newTask("Error interno");
  const original = db.entregasTarea.count;
  db.entregasTarea.count = async () => { throw new Error("SELECT * FROM usuarios WHERE password"); };
  try {
    const res = await submit(taskId, ctx.tokens.alumno1);
    assert.equal(res.status, 500);
    assert.doesNotMatch(res.body.message, /SELECT/);
  } finally {
    db.entregasTarea.count = original;
  }
});

test("inscripción: sin secciones ofertadas responde lista vacía y el alumno sin perfil recibe 404", async () => {
  const empty = await request(app).get(`/api/ofertas-curso/disponibles?periodoAcademicoId=${ctx.periodo}`).set(auth(ctx.tokens.alumno1));
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, []);
  assert.equal((await request(app).get(`/api/ofertas-curso/disponibles?periodoAcademicoId=${ctx.periodo}`).set(auth(ctx.tokens.docente))).status, 403);
  assert.equal((await request(app).get("/api/ofertas-curso/disponibles").set(auth(ctx.tokens.alumno1))).status, 400);
});

test("rutas de lectura: PostgreSQL caído responde 503 seguro y errores inesperados 500 genérico", async () => {
  const spy = console.error;
  console.error = () => {};
  const original = db.tareas.findAll;
  try {
    db.tareas.findAll = async () => {
      throw Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), { name: "SequelizeConnectionRefusedError" });
    };
    const down = await request(app).get("/api/tareas").set(auth(ctx.tokens.alumno1));
    assert.equal(down.status, 503);
    assert.doesNotMatch(JSON.stringify(down.body), /10\.0\.0\.1|ECONNREFUSED/);
    db.tareas.findAll = async () => { throw new Error("relation \"tareas\" column secret_x"); };
    const bad = await request(app).get("/api/tareas").set(auth(ctx.tokens.alumno1));
    assert.equal(bad.status, 500);
    assert.doesNotMatch(JSON.stringify(bad.body), /secret_x|relation/);
  } finally {
    db.tareas.findAll = original;
    console.error = spy;
  }
  const found = await request(app).get("/api/tareas/999999").set(auth(ctx.tokens.docente));
  assert.equal(found.status, 404, "los errores con estado explícito se conservan");
});
