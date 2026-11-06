process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "clave-de-pruebas-con-mas-de-32-caracteres";
process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");

const realDb = require("../app/models");
const app = require("../app");
const { startServer } = require("../server");

function get(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path, agent: false }, res => {
      let body = "";
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    }).on("error", reject);
  });
}

// Base simulada cuya conexión se resuelve o rechaza a voluntad.
function fakeDatabase() {
  let resolveAuth;
  let rejectAuth;
  const auth = new Promise((resolve, reject) => { resolveAuth = resolve; rejectAuth = reject; });
  const calls = [];
  return {
    resolveAuth,
    rejectAuth,
    calls,
    database: {
      sequelize: {
        authenticate: () => { calls.push("authenticate"); return auth; },
        query: async () => { calls.push("query"); },
        sync: async () => { calls.push("sync"); },
        close: async () => { calls.push("close"); }
      }
    }
  };
}

async function withQuietLogs(fn) {
  const { log, error } = console;
  const lines = [];
  console.log = (...args) => lines.push(args.map(String).join(" "));
  console.error = (...args) => lines.push(args.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  try {
    return await fn(lines);
  } finally {
    console.log = log;
    console.error = error;
  }
}

test.afterEach(() => { delete app.locals.startup; });
test.after(async () => { await realDb.sequelize.close(); });

test("el puerto se abre antes de terminar la conexión y /ready responde 503 mientras tanto", async () => {
  await withQuietLogs(async () => {
    const fake = fakeDatabase();
    const exits = [];
    const { server, initialization, shutdown } = await startServer({
      database: fake.database, port: 0, exit: code => exits.push(code), handleSignals: false
    });
    const { port } = server.address();
    assert.ok(server.listening);
    assert.deepEqual(fake.calls, ["authenticate"]);

    const health = await get(port, "/health");
    assert.equal(health.status, 200);
    const ready = await get(port, "/ready");
    assert.equal(ready.status, 503);
    assert.deepEqual(ready.body.checks, { database: "starting", schema: "unknown" });

    fake.resolveAuth();
    await initialization;
    assert.deepEqual(fake.calls, ["authenticate", "query", "sync"]);
    assert.equal(app.locals.startup.state, "ready");
    assert.deepEqual(exits, []);
    await shutdown();
  });
});

test("/ready responde 200 con el formato existente tras completar las comprobaciones", async () => {
  await withQuietLogs(async () => {
    const exits = [];
    const { server, initialization, shutdown } = await startServer({
      database: { sequelize: Object.create(realDb.sequelize, { close: { value: async () => {} } }) },
      port: 0, exit: code => exits.push(code), handleSignals: false
    });
    await initialization;
    const ready = await get(server.address().port, "/ready");
    assert.equal(ready.status, 200);
    assert.deepEqual(ready.body, { status: "ready", checks: { database: "ok", schema: "ok" } });
    assert.deepEqual(exits, []);
    await shutdown();
  });
});

test("si PostgreSQL falla no se marca como preparado, se registra un error seguro y se sale con 1", async () => {
  await withQuietLogs(async lines => {
    const fake = fakeDatabase();
    const exits = [];
    const { server, initialization, shutdown } = await startServer({
      database: fake.database, port: 0, exit: code => exits.push(code), handleSignals: false
    });
    const { port } = server.address();
    const failure = new Error("connect ECONNREFUSED");
    failure.parent = { code: "ECONNREFUSED" };
    fake.rejectAuth(failure);
    await initialization;

    assert.deepEqual(exits, [1]);
    assert.equal(app.locals.startup.state, "failed");
    const ready = await get(port, "/ready");
    assert.equal(ready.status, 503);
    assert.deepEqual(ready.body.checks, { database: "unavailable", schema: "unknown" });
    assert.ok(lines.some(line => line.includes("Error al conectar con PostgreSQL") && line.includes("ECONNREFUSED")));
    await shutdown();
  });
});

test("un fallo de sync en desarrollo o prueba tampoco deja el servicio preparado", async () => {
  await withQuietLogs(async () => {
    const fake = fakeDatabase();
    fake.database.sequelize.sync = async () => { throw new Error("sync falló"); };
    const exits = [];
    const { initialization, shutdown } = await startServer({
      database: fake.database, port: 0, exit: code => exits.push(code), handleSignals: false
    });
    fake.resolveAuth();
    await initialization;
    assert.deepEqual(exits, [1]);
    assert.notEqual(app.locals.startup.state, "ready");
    await shutdown();
  });
});

test("el cierre ordenado libera el puerto y la base de datos, y una conexión tardía no marca ready", async () => {
  await withQuietLogs(async () => {
    const fake = fakeDatabase();
    const { server, initialization, shutdown } = await startServer({
      database: fake.database, port: 0, exit: () => {}, handleSignals: false
    });
    const { port } = server.address();
    await shutdown();
    assert.equal(server.listening, false);
    assert.ok(fake.calls.includes("close"));
    await assert.rejects(() => get(port, "/health"), { code: "ECONNREFUSED" });

    fake.resolveAuth();
    await initialization;
    assert.equal(app.locals.startup.state, "stopping");
  });
});

test("shutdown es idempotente", async () => {
  await withQuietLogs(async () => {
    const fake = fakeDatabase();
    const { shutdown } = await startServer({ database: fake.database, port: 0, exit: () => {}, handleSignals: false });
    await Promise.all([shutdown(), shutdown()]);
    assert.equal(fake.calls.filter(call => call === "close").length, 1);
    fake.resolveAuth();
  });
});

test("si el puerto está ocupado se sale con 1 sin marcar ready", async () => {
  await withQuietLogs(async () => {
    const blocker = net.createServer();
    await new Promise(resolve => blocker.listen(0, "0.0.0.0", resolve));
    const exits = [];
    await startServer({
      database: fakeDatabase().database, port: blocker.address().port, exit: code => exits.push(code), handleSignals: false
    });
    assert.deepEqual(exits, [1]);
    assert.equal(app.locals.startup.state, "failed");
    await new Promise(resolve => blocker.close(resolve));
  });
});

test("sin arranque gestionado (app.locals.startup ausente) /ready sigue usando solo las comprobaciones en vivo", async () => {
  assert.equal(app.locals.startup, undefined);
  await withQuietLogs(async () => {
    await realDb.sequelize.sync();
    const request = require("supertest");
    const ready = await request(app).get("/ready");
    assert.equal(ready.status, 200);
  });
});
