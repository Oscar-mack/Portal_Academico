const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const confirmation = "I_CONFIRM_LOCAL_ISOLATED_DISPOSABLE_DATABASE_NO_TUNNEL";

function loadModels(databaseUrl, explicitConfirmation = confirmation) {
  const result = spawnSync(process.execPath, [
    "-e",
    "const db = require('./app/models'); db.sequelize.close().then(() => process.stdout.write('loaded'));"
  ], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "test",
      TEST_DATABASE_URL: databaseUrl,
      TEST_DATABASE_DISPOSABLE: explicitConfirmation,
      SSH_CONNECTION: "",
      SSH_CLIENT: "",
      SSH_TTY: "",
      PGHOSTADDR: "",
      PGSERVICE: "",
      PGSERVICEFILE: "",
      DATABASE_URL: "",
      DB_HOST: "",
      DB_USER: "",
      DB_PASSWORD: "",
      DB_NAME: ""
    }
  });
  return result;
}

test("PostgreSQL destructivo requiere confirmación explícita", () => {
  const result = loadModels("postgres://local_user:unused@127.0.0.1:5432/portal_academico_discardable_guard", "");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requieren TEST_DATABASE_DISPOSABLE/);
});

test("el guard rechaza destinos remotos, puerto implícito, nombre no descartable y parámetros de URL", () => {
  const rejectedUrls = [
    "postgres://local_user:unused@db.example.test:5432/portal_academico_discardable_guard",
    "postgres://local_user:unused@127.0.0.1/portal_academico_discardable_guard",
    "postgres://local_user:unused@127.0.0.1:5432/portal_academico",
    "postgres://local_user:unused@127.0.0.1:5432/portal_academico_discardable_guard?host=db.example.test"
  ];
  for (const url of rejectedUrls) {
    const result = loadModels(url);
    assert.notEqual(result.status, 0, "una URL insegura no debe cargar el modelo");
    assert.doesNotMatch(result.stderr, /ECONNREFUSED|ENOTFOUND/, "el rechazo ocurre antes de conectar");
  }
});

test("el guard rechaza una sesión SSH o un indicador de túnel", () => {
  const result = spawnSync(process.execPath, [
    "-e",
    "process.env.NODE_ENV='test'; require('./app/models');"
  ], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "test",
      TEST_DATABASE_URL: "postgres://local_user:unused@127.0.0.1:5432/portal_academico_discardable_guard",
      TEST_DATABASE_DISPOSABLE: confirmation,
      SSH_CONNECTION: "local-session",
      SSH_CLIENT: "",
      SSH_TTY: "",
      PGHOSTADDR: "",
      PGSERVICE: "",
      PGSERVICEFILE: "",
      DATABASE_URL: "",
      DB_HOST: "",
      DB_USER: "",
      DB_PASSWORD: "",
      DB_NAME: ""
    }
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no admiten sesiones SSH/);
});
