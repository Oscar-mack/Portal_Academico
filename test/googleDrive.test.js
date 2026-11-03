process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "clave-de-pruebas-con-mas-de-32-caracteres";
process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const bcrypt = require("bcryptjs");

const db = require("../app/models");
const app = require("../app");
const storage = require("../app/services/r2Storage.js");
const drive = require("../app/services/googleDriveStorage.js");
const tokenStore = require("../app/services/googleTokenStore.js");
const { uploadMultipart } = require("../app/utils/academicFileUpload.js");

const NAMES = ["STORAGE_PROVIDER", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "GOOGLE_REFRESH_TOKEN",
  "GOOGLE_REFRESH_TOKEN_ENC",
  "GOOGLE_DRIVE_FOLDER_ID", "GOOGLE_DRIVE_MAX_FILE_BYTES", "GOOGLE_TOKEN_ENCRYPTION_KEY", "GOOGLE_TOKEN_STORE_PATH", "APP_URL",
  "FRONTEND_URL",
  "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_BUCKET"];
const CALLBACK = "https://portal-academico-backend-ensayo.onrender.com/api/auth/google/callback";
const FOLDER = "folderIdParaPruebas123";
const ID = "123e4567-e89b-12d3-a456-426614174000";
const KEY = `materials/${ID}`;
const CLIENT_SECRET = "GOCSPX-secreto-de-prueba-unitaria";
const REFRESH = "1//refresh-token-de-prueba-unitaria";
const ACCESS = "ya29.access-token-de-prueba-unitaria";
const ENCRYPTION = "clave-de-cifrado-de-pruebas-con-mas-de-32-caracteres";
const PDF = Buffer.from("%PDF-1.4 contenido de prueba");
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function withDrive(handler, fn, extra = {}, options = {}) {
  const saved = Object.fromEntries(NAMES.map(n => [n, process.env[n]]));
  NAMES.forEach(n => delete process.env[n]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gdrive-test-"));
  Object.assign(process.env, {
    STORAGE_PROVIDER: "gdrive", GOOGLE_CLIENT_ID: "cliente-de-prueba.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: CLIENT_SECRET, GOOGLE_REDIRECT_URI: CALLBACK,
    GOOGLE_DRIVE_FOLDER_ID: FOLDER, GOOGLE_TOKEN_ENCRYPTION_KEY: ENCRYPTION,
    GOOGLE_TOKEN_STORE_PATH: path.join(dir, "token.enc"), APP_URL: "https://portal-academico-backend-ensayo.onrender.com",
    FRONTEND_URL: "https://portal-academico-frontend.onrender.com", ...extra
  });
  tokenStore.write({ refreshToken: REFRESH });
  drive.resetAccessTokenCache();
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const call = {
      url: String(url), method: init.method || "GET", headers: init.headers || {}, body: init.body,
      signal: init.signal
    };
    calls.push(call);
    if (call.url.startsWith("https://oauth2.googleapis.com/token") && call.body?.get?.("grant_type") === "refresh_token") {
      return options.refreshTokenResponse ? options.refreshTokenResponse(call) : json({ access_token: ACCESS, expires_in: 3600 });
    }
    const parsedUrl = new URL(call.url);
    if (/^\/drive\/v3\/files\/[^/]+$/.test(parsedUrl.pathname) && parsedUrl.searchParams.has("fields")) {
      return options.folderAccessResponse
        ? options.folderAccessResponse(call)
        : json({
          id: parsedUrl.pathname.split("/").pop(),
          name: "Carpeta",
          mimeType: "application/vnd.google-apps.folder",
          trashed: false
        });
    }
    return handler(call);
  };
  const logs = [];
  const { error, log } = console;
  console.error = (...a) => logs.push(a.join(" "));
  console.log = (...a) => logs.push(a.join(" "));
  try {
    return await fn({ calls, logs, dir });
  } finally {
    globalThis.fetch = realFetch;
    console.error = error;
    console.log = log;
    fs.rmSync(dir, { recursive: true, force: true });
    NAMES.forEach(n => (saved[n] === undefined ? delete process.env[n] : (process.env[n] = saved[n])));
  }
}

function assertNoSecrets(logs, extra = []) {
  const text = logs.join("\n");
  for (const secret of [CLIENT_SECRET, REFRESH, ACCESS, ENCRYPTION, "Bearer ", ...extra]) {
    assert.ok(!text.includes(secret), `el log no debe contener ${secret.slice(0, 8)}…`);
  }
}

test.before(async () => {
  await db.sequelize.sync({ force: true });
  await db.usuarios.create({ username: "gdadmin", email: "gd@prueba.edu", password: bcrypt.hashSync("ClaveSegura123", 4), rol: "admin" });
  await db.usuarios.create({ username: "gdalumno", email: "gdal@prueba.edu", password: bcrypt.hashSync("ClaveSegura123", 4), rol: "alumno" });
});
test.after(() => db.sequelize.close());

async function login(username) {
  const res = await request(app).post("/api/auth/signin").send({ username, password: "ClaveSegura123" });
  return res.body.accessToken || res.body.token;
}

function callbackRequest(query, flow, includeCookie = true) {
  const req = request(app).get("/api/auth/google/callback").query(query);
  return includeCookie ? req.set("Cookie", [
    `${flow.cookieName}=${encodeURIComponent(flow.cookieValue)}`,
    `${flow.adminCookieName}=${encodeURIComponent(flow.adminCookieValue)}`
  ].join("; ")) : req;
}

test("el almacén cifra el refresh token y no lo guarda en claro", async () => {
  await withDrive(() => json({}), async ({ dir }) => {
    tokenStore.write({ refreshToken: REFRESH });
    const raw = fs.readFileSync(path.join(dir, "token.enc"), "utf8");
    assert.ok(!raw.includes(REFRESH));
    assert.equal(tokenStore.read().refreshToken, REFRESH);
    assert.equal(fs.statSync(path.join(dir, "token.enc")).mode & 0o777, 0o600);
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = "otra-clave-de-cifrado-distinta-de-32-caracteres";
    assert.throws(() => tokenStore.read(), error => error.code === "TOKEN_STORE_CORRUPT");
  });
});

test("el almacén rechaza escribir sin clave de cifrado suficiente", async () => {
  await withDrive(() => json({}), async () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = "corta";
    assert.throws(() => tokenStore.write({ refreshToken: REFRESH }), /32 caracteres/);
  });
});

test("el valor cifrado de entorno tiene prioridad sobre el archivo y es de solo lectura", async () => {
  await withDrive(() => json({}), async () => {
    const encryptedNew = tokenStore.exportEncryptedEnvironmentValue();
    tokenStore.write({ refreshToken: "token-antiguo-de-prueba" });
    process.env.GOOGLE_REFRESH_TOKEN_ENC = encryptedNew;
    assert.equal(tokenStore.read().refreshToken, REFRESH);
    assert.throws(() => tokenStore.write({ refreshToken: "token-nuevo" }), error => error.code === "TOKEN_STORE_ENV_CONFIGURED");
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = "clave-incorrecta-pero-suficientemente-larga";
    assert.throws(() => tokenStore.read(), error => error.code === "TOKEN_STORE_CORRUPT");
  });
});

test("se rechaza la variable antigua de refresh token en texto plano", async () => {
  await withDrive(() => json({}), async () => {
    process.env.GOOGLE_REFRESH_TOKEN = REFRESH;
    assert.throws(() => storage.ensureConfigured(), error => error.status === 503 && /GOOGLE_REFRESH_TOKEN_ENC/.test(error.message));
    assert.throws(() => drive.startAuthorization(1, "admin"), error => error.status === 503);
  });
});

test("la URL de autorización pide acceso offline, drive.file, PKCE y no incluye el secreto", async () => {
  await withDrive(() => json({}), async () => {
    const flow = drive.startAuthorization(1, "admin");
    const { authorizationUrl } = flow;
    assert.throws(() => drive.startAuthorization(2, "alumno"), { status: 403 });
    const url = new URL(authorizationUrl);
    assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("prompt"), "consent");
    assert.equal(url.searchParams.get("scope"), "https://www.googleapis.com/auth/drive.file");
    assert.equal(url.searchParams.get("redirect_uri"), CALLBACK);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.ok(url.searchParams.get("state").length >= 64);
    assert.match(flow.cookieName, /^gdrive_oauth_[a-f0-9]{64}$/);
    assert.equal(flow.cookieValue.length, 43);
    assert.ok(flow.adminCookieValue);
    assert.ok(!authorizationUrl.includes(CLIENT_SECRET));
  });
});

test("GOOGLE_REDIRECT_URI debe ser https y apuntar al callback", async () => {
  for (const bad of ["http://portal.example/api/auth/google/callback", "https://portal.example/otra", "no-es-url"]) {
    await withDrive(() => json({}), async () => {
      assert.throws(() => drive.startAuthorization(1, "admin"), error => error.status === 503);
    }, { GOOGLE_REDIRECT_URI: bad });
  }
});

test("el callback intercambia el código, guarda el refresh token cifrado y no lo expone", async () => {
  await withDrive(call => {
    assert.ok(call.url.startsWith("https://oauth2.googleapis.com/token"));
    assert.equal(call.body.get("grant_type"), "authorization_code");
    assert.equal(call.body.get("code"), "codigo-de-prueba");
    assert.ok(call.body.get("code_verifier"));
    return json({ refresh_token: REFRESH, access_token: ACCESS, scope: "https://www.googleapis.com/auth/drive.file" });
  }, async ({ dir, logs }) => {
    fs.rmSync(tokenStore.storePath());
    const flow = drive.startAuthorization(1, "admin");
    const state = new URL(flow.authorizationUrl).searchParams.get("state");
    const otherBrowser = await callbackRequest({ code: "codigo-de-prueba", state }, flow, false);
    assert.equal(otherBrowser.status, 400);
    const res = await callbackRequest({ code: "codigo-de-prueba", state }, flow);
    assert.equal(res.status, 303);
    assert.equal(res.headers.location, "https://portal-academico-frontend.onrender.com/portal?googleDrive=authorized");
    assert.ok(!res.text.includes(REFRESH) && !res.text.includes(ACCESS) && !res.text.includes(CLIENT_SECRET));
    assert.equal(tokenStore.read().refreshToken, REFRESH);
    assert.ok(!fs.readFileSync(path.join(dir, "token.enc"), "utf8").includes(REFRESH));
    // El estado es de un solo uso.
    const again = await callbackRequest({ code: "codigo-de-prueba", state }, flow);
    assert.equal(again.status, 303);
    assert.equal(again.headers.location, "https://portal-academico-frontend.onrender.com/portal?googleDrive=expired");
    assert.ok(!again.headers.location.includes("codigo-de-prueba"));
    assertNoSecrets(logs);
  });
});

test("el callback cancelado vuelve al portal con estado neutral y sin parámetros de Google", async () => {
  await withDrive(() => {
    throw new Error("una cancelación no debe llamar a Google");
  }, async ({ calls }) => {
    const flow = drive.startAuthorization(1, "admin");
    const state = new URL(flow.authorizationUrl).searchParams.get("state");
    const res = await callbackRequest({ error: "access_denied", state }, flow);
    assert.equal(res.status, 303);
    assert.equal(res.headers.location, "https://portal-academico-frontend.onrender.com/portal?googleDrive=cancelled");
    assert.ok(!res.headers.location.includes(state));
    assert.ok(!res.headers.location.includes("access_denied"));
    assert.ok(!res.headers.location.includes("code="));
    assert.equal(calls.length, 0);
    assert.match(res.headers["referrer-policy"], /no-referrer/);
  });
});

test("un state expirado o perdido tras reinicio regresa al portal como expirado", async () => {
  await withDrive(() => {
    throw new Error("un state expirado no debe canjear código");
  }, async () => {
    const flow = drive.startAuthorization(1, "admin");
    const state = new URL(flow.authorizationUrl).searchParams.get("state");
    const now = Date.now;
    Date.now = () => now() + 11 * 60 * 1000;
    try {
      const expired = await callbackRequest({ code: "codigo-no-debe-reenviarse", state }, flow);
      assert.equal(expired.status, 303);
      assert.equal(expired.headers.location, "https://portal-academico-frontend.onrender.com/portal?googleDrive=expired");
      assert.ok(!expired.headers.location.includes("codigo-no-debe-reenviarse"));
      assert.equal(drive.authorizationCallbackStatus({
        state,
        cookieValue: flow.cookieValue,
        adminProof: flow.adminCookieValue
      }), "expired");
    } finally {
      Date.now = now;
    }

    const restartedFlow = drive.startAuthorization(1, "admin");
    const restartedState = new URL(restartedFlow.authorizationUrl).searchParams.get("state");
    drive.cancelAuthorization({
      state: restartedState,
      cookieValue: restartedFlow.cookieValue,
      adminProof: restartedFlow.adminCookieValue
    });
    const lostState = await callbackRequest({ code: "otro-codigo", state: restartedState }, restartedFlow);
    assert.equal(lostState.status, 303);
    assert.equal(lostState.headers.location, "https://portal-academico-frontend.onrender.com/portal?googleDrive=expired");
  });
});

test("un error OAuth de Google vuelve con resultado genérico y nunca refleja el error ni el state", async () => {
  await withDrive(() => {
    throw new Error("no debe canjearse una autorización denegada");
  }, async ({ calls }) => {
    const flow = drive.startAuthorization(1, "admin");
    const state = new URL(flow.authorizationUrl).searchParams.get("state");
    const res = await callbackRequest({ error: "temporarily_unavailable", state }, flow);
    assert.equal(res.status, 303);
    assert.equal(res.headers.location, "https://portal-academico-frontend.onrender.com/portal?googleDrive=error");
    assert.ok(!res.headers.location.includes(state));
    assert.ok(!res.headers.location.includes("temporarily_unavailable"));
    assert.equal(calls.length, 0);
  });
});

test("un error en el canje vuelve al portal sin exponer códigos OAuth", async () => {
  await withDrive(() => json({ error: "invalid_grant", error_description: "detalle privado" }, 400), async () => {
    const flow = drive.startAuthorization(1, "admin");
    const state = new URL(flow.authorizationUrl).searchParams.get("state");
    const res = await callbackRequest({ code: "codigo-sensible", state }, flow);
    assert.equal(res.status, 303);
    assert.equal(res.headers.location, "https://portal-academico-frontend.onrender.com/portal?googleDrive=error");
    assert.ok(!res.headers.location.includes("codigo-sensible"));
    assert.ok(!res.headers.location.includes(state));
    assert.ok(!res.headers.location.includes("invalid_grant"));
  });
});

test("state inválido, cookies cruzadas o prueba de otro administrador nunca redirigen como éxito", async () => {
  await withDrive(() => json({ refresh_token: REFRESH, scope: "https://www.googleapis.com/auth/drive.file" }), async ({ calls }) => {
    const invalid = await request(app).get("/api/auth/google/callback")
      .query({ code: "codigo-sensible", state: "estado-inventado" });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.headers.location, undefined);
    assert.ok(!invalid.text.includes("codigo-sensible"));
    assert.equal(calls.length, 0);

    const first = drive.startAuthorization(1, "admin");
    const firstState = new URL(first.authorizationUrl).searchParams.get("state");
    const otherBrowser = await callbackRequest({ error: "access_denied", state: firstState }, first, false);
    assert.equal(otherBrowser.status, 400);
    assert.equal(otherBrowser.headers.location, undefined);

    const second = drive.startAuthorization(2, "admin");
    const crossed = await callbackRequest({ code: "codigo-sensible", state: firstState }, second);
    assert.equal(crossed.status, 400);
    assert.equal(crossed.headers.location, undefined);
  });
});

test("el state expira, no se consume ante cookie inválida y se consume una sola vez", async () => {
  await withDrive(() => json({ refresh_token: REFRESH, scope: "https://www.googleapis.com/auth/drive.file" }), async () => {
    const flow = drive.startAuthorization(1, "admin");
    const state = new URL(flow.authorizationUrl).searchParams.get("state");
    const now = Date.now;
    Date.now = () => now() + 11 * 60 * 1000;
    try {
      await assert.rejects(drive.completeAuthorization({
        code: "x", state, cookieValue: flow.cookieValue, adminProof: flow.adminCookieValue
      }), { status: 400 });
    } finally {
      Date.now = now;
    }

    const next = drive.startAuthorization(1, "admin");
    const nextState = new URL(next.authorizationUrl).searchParams.get("state");
    await assert.rejects(drive.completeAuthorization({
      code: "x", state: nextState, cookieValue: "otro-navegador", adminProof: next.adminCookieValue
    }), { status: 400 });
    const otherAdmin = drive.startAuthorization(2, "admin");
    await assert.rejects(drive.completeAuthorization({
      code: "x", state: nextState, cookieValue: next.cookieValue, adminProof: otherAdmin.adminCookieValue
    }), { status: 400 });
    assert.equal((await callbackRequest({ code: "x", state: nextState }, next)).status, 303);
    await assert.rejects(drive.completeAuthorization({
      code: "x", state: nextState, cookieValue: next.cookieValue, adminProof: next.adminCookieValue
    }), { status: 400 });
  });
});

test("el callback rechaza estado desconocido, errores de Google y respuestas sin refresh token o scope", async () => {
  await withDrive(() => json({ access_token: ACCESS, scope: "https://www.googleapis.com/auth/drive.file" }), async ({ logs }) => {
    assert.equal((await request(app).get("/api/auth/google/callback").query({ code: "x", state: "inventado" })).status, 400);
    const deniedFlow = drive.startAuthorization(1, "admin");
    const deniedState = new URL(deniedFlow.authorizationUrl).searchParams.get("state");
    const denied = await callbackRequest({ error: "access_denied", state: deniedState }, deniedFlow);
    assert.equal(denied.status, 303);
    assert.equal(denied.headers.location, "https://portal-academico-frontend.onrender.com/portal?googleDrive=cancelled");
    const flow = drive.startAuthorization(1, "admin");
    const state = new URL(flow.authorizationUrl).searchParams.get("state");
    const res = await callbackRequest({ code: "x", state }, flow);
    assert.equal(res.status, 303);
    assert.equal(res.headers.location, "https://portal-academico-frontend.onrender.com/portal?googleDrive=error");
    assertNoSecrets(logs);
  });
  await withDrive(() => json({ refresh_token: REFRESH, scope: "email" }), async () => {
    fs.rmSync(tokenStore.storePath());
    const flow = drive.startAuthorization(1, "admin");
    const state = new URL(flow.authorizationUrl).searchParams.get("state");
    const res = await callbackRequest({ code: "x", state }, flow);
    assert.equal(res.status, 303);
    assert.equal(res.headers.location, "https://portal-academico-frontend.onrender.com/portal?googleDrive=error");
    assert.equal(tokenStore.read().refreshToken, undefined);
  });
});

test("un fallo de Google al canjear el código devuelve 503 genérico sin secretos", async () => {
  await withDrive(() => json({ error: "invalid_grant", error_description: `${REFRESH} ${CLIENT_SECRET}` }, 400), async ({ logs }) => {
    fs.rmSync(tokenStore.storePath());
    const flow = drive.startAuthorization(1, "admin");
    const state = new URL(flow.authorizationUrl).searchParams.get("state");
    const res = await callbackRequest({ code: "x", state }, flow);
    assert.equal(res.status, 303);
    assert.equal(res.headers.location, "https://portal-academico-frontend.onrender.com/portal?googleDrive=error");
    assert.ok(!res.headers.location.includes("invalid_grant"));
    assert.match(logs.join("\n"), /proveedor=gdrive.*status=400.*codigo=invalid_grant/);
    assertNoSecrets(logs);
  });
});

test("solo el administrador inicia la autorización y consulta el estado", async () => {
  await withDrive(() => json({ id: FOLDER, name: "Carpeta", mimeType: "application/vnd.google-apps.folder" }), async ({ logs }) => {
    assert.equal((await request(app).post("/api/auth/google/iniciar")).status, 403);
    const student = await login("gdalumno");
    assert.equal((await request(app).post("/api/auth/google/iniciar").set("Authorization", `Bearer ${student}`)).status, 403);
    assert.equal((await request(app).get("/api/auth/google/estado").set("Authorization", `Bearer ${student}`)).status, 403);
    const admin = await login("gdadmin");
    const start = await request(app).post("/api/auth/google/iniciar").set("Authorization", `Bearer ${admin}`);
    assert.equal(start.status, 200);
    assert.match(start.body.authorizationUrl, /^https:\/\/accounts\.google\.com\//);
    assert.equal(start.headers["set-cookie"].length, 2);
    assert.ok(start.headers["set-cookie"].every(cookie => cookie.includes("HttpOnly") && cookie.includes("SameSite=Lax") && cookie.includes("Secure")));
    assert.ok(start.headers["set-cookie"].every(cookie => cookie.includes("Max-Age=1800")));
    assert.ok(!JSON.stringify(start.body).includes("cookieValue"));
    const status = await request(app).get("/api/auth/google/estado").set("Authorization", `Bearer ${admin}`);
    assert.equal(status.status, 200);
    assert.deepEqual(status.body.folder, { configured: true, id: FOLDER, accessible: true, name: "Carpeta" });
    const text = JSON.stringify(status.body);
    for (const secret of [CLIENT_SECRET, REFRESH, ACCESS]) assert.ok(!text.includes(secret));
    assertNoSecrets(logs);
  });
});

test("el estado indica que una carpeta ajena no es accesible con drive.file y se puede crear una propia", async () => {
  await withDrive(call => {
    if (call.method === "POST") return json({ id: "carpetaCreadaPorApp1234" });
    return json({ error: { status: "NOT_FOUND", errors: [{ reason: "notFound" }] } }, 404);
  }, async () => {
    tokenStore.write({ refreshToken: REFRESH });
    const admin = await login("gdadmin");
    const status = await request(app).get("/api/auth/google/estado").set("Authorization", `Bearer ${admin}`);
    assert.equal(status.body.folder.accessible, false);
    const created = await request(app).post("/api/auth/google/carpeta").set("Authorization", `Bearer ${admin}`).send({});
    assert.equal(created.status, 201);
    assert.equal(created.body.id, "carpetaCreadaPorApp1234");
    assert.equal(created.body.persisted, true);
    assert.equal(tokenStore.read().folderId, "carpetaCreadaPorApp1234");
    assert.equal((await request(app).post("/api/auth/google/carpeta").set("Authorization", `Bearer ${admin}`).send({ nombre: 5 })).status, 400);
  }, {}, { folderAccessResponse: () => json({ error: { status: "NOT_FOUND" } }, 404) });
});

test("con token cifrado de entorno, una carpeta nueva devuelve el ID y GOOGLE_DRIVE_FOLDER_ID lo prioriza", async () => {
  await withDrive(call => {
    if (call.method === "POST") return json({ id: "carpetaNuevaEnRender1234" });
    return json({ id: "archivoSubido123" });
  }, async ({ calls }) => {
    process.env.GOOGLE_REFRESH_TOKEN_ENC = tokenStore.exportEncryptedEnvironmentValue();
    assert.equal((await drive.status()).environmentTokenReadOnly, true);
    const result = await drive.createFolder("Carpeta temporal");
    assert.deepEqual(result, {
      id: "carpetaNuevaEnRender1234",
      name: "Carpeta temporal",
      persisted: false,
      configure: "GOOGLE_DRIVE_FOLDER_ID",
      message: "La carpeta se creó; configura GOOGLE_DRIVE_FOLDER_ID para conservarla."
    });
    process.env.GOOGLE_DRIVE_FOLDER_ID = result.id;
    await storage.uploadObject(KEY, PDF, "application/pdf");
    const body = Buffer.from(calls.find(call => call.url.includes("/upload/drive/v3/files")).body).toString("latin1");
    assert.ok(body.includes(`"parents":["${result.id}"]`));
  });
});

test("la subida envía nombre, carpeta, Content-Type y contenido con el token de acceso", async () => {
  let uploadResponse;
  await withDrive(call => {
    uploadResponse = json({ id: "archivoSubido123" });
    return uploadResponse;
  }, async ({ calls, logs }) => {
    await storage.uploadObject(KEY, Readable.from([PDF]), "application/pdf");
    assert.equal(uploadResponse.bodyUsed, true);
    const upload = calls.find(c => c.url.startsWith("https://www.googleapis.com/upload/drive/v3/files"));
    assert.equal(upload.method, "POST");
    assert.equal(upload.headers.Authorization, `Bearer ${ACCESS}`);
    assert.match(upload.headers["Content-Type"], /^multipart\/related; boundary=/);
    const body = Buffer.from(upload.body).toString("latin1");
    assert.ok(body.includes(`"name":"${KEY}"`) && body.includes(`"parents":["${FOLDER}"]`));
    assert.ok(body.includes("Content-Type: application/pdf") && body.includes(PDF.toString("latin1")));
    // El access token se reutiliza hasta que caduque.
    await storage.uploadObject(`tasks/${ID}`, PDF, "application/pdf");
    assert.equal(calls.filter(c => c.url.startsWith("https://oauth2.googleapis.com/token")).length, 1);
    assertNoSecrets(logs);
  });
});

test("una sola subida Drive puede acumular archivos; las demás reciben 429 sin esperar", async () => {
  let releaseUpload;
  let markStarted;
  const uploadStarted = new Promise(resolve => { markStarted = resolve; });
  await withDrive(call => {
    if (call.url.startsWith("https://www.googleapis.com/upload/drive/v3/files")) {
      markStarted();
      return new Promise(resolve => { releaseUpload = () => resolve(json({ id: "archivoSubido123" })); });
    }
    return json({ id: FOLDER, name: "Carpeta", mimeType: "application/vnd.google-apps.folder" });
  }, async () => {
    const first = storage.uploadObject(KEY, PDF, "application/pdf");
    await uploadStarted;
    await assert.rejects(storage.uploadObject(`tasks/${ID}`, PDF, "application/pdf"), {
      status:  429,
      message: /otra subida/
    });
    await assert.rejects(storage.uploadObject(`submissions/${ID}`, PDF, "application/pdf"), { status: 429 });
    releaseUpload();
    await first;
  });
});

test("una subida rechazada por concurrencia no elimina un objeto existente con la misma clave", async () => {
  await withDrive(() => json({}), async () => {
    const originalUpload = storage.uploadObject;
    const originalRemove = storage.removeObject;
    let removals = 0;
    storage.uploadObject = async () => { throw Object.assign(new Error("ocupado"), { status: 429 }); };
    storage.removeObject = async () => { removals += 1; };
    const boundary = "drive-upload-test";
    const requestBody = [
      `--${boundary}\r\n`,
      'Content-Disposition: form-data; name="file"; filename="tarea.pdf"\r\n',
      "Content-Type: application/pdf\r\n\r\n",
      "%PDF-1.4 contenido\r\n",
      `--${boundary}--\r\n`
    ].join("");
    const req = Readable.from([Buffer.from(requestBody)]);
    req.headers = { "content-type": `multipart/form-data; boundary=${boundary}` };
    try {
      await assert.rejects(uploadMultipart(req, KEY), { status: 429 });
      assert.equal(removals, 0);
    } finally {
      storage.uploadObject = originalUpload;
      storage.removeObject = originalRemove;
    }
  });
});

test("el espacio de concurrencia se libera tras una subida fallida", async () => {
  await withDrive(call => {
    if (call.url.startsWith("https://www.googleapis.com/upload/drive/v3/files")) {
      return json({ error: "backendError" }, 503);
    }
    return json({ id: FOLDER, name: "Carpeta", mimeType: "application/vnd.google-apps.folder" });
  }, async ({ calls }) => {
    await assert.rejects(storage.uploadObject(KEY, PDF, "application/pdf"), { status: 503 });
    await assert.rejects(storage.uploadObject(`tasks/${ID}`, PDF, "application/pdf"), { status: 503 });
    assert.equal(calls.filter(call => call.url.startsWith("https://www.googleapis.com/upload/drive/v3/files")).length, 2);
  });
});

test("la subida valida tipo, tamaño y clave antes de llamar a Google", async () => {
  await withDrive(() => json({ id: "x" }), async ({ calls }) => {
    await assert.rejects(storage.uploadObject(KEY, PDF, "application/x-msdownload"), { status: 415 });
    await assert.rejects(storage.uploadObject("../etc/passwd", PDF, "application/pdf"), { status: 500 });
    await assert.rejects(storage.uploadObject(KEY, Buffer.alloc(11), "application/pdf"), { status: 413 });
    await assert.rejects(storage.uploadObject(KEY, Readable.from([Buffer.alloc(8), Buffer.alloc(8)]), "application/pdf"), { status: 413 });
    assert.equal(calls.length, 0);
  }, { GOOGLE_DRIVE_MAX_FILE_BYTES: "10" });
});

test("sin autorización o carpeta el proveedor responde 503 controlado", async () => {
  await withDrive(() => json({}), async ({ calls, logs }) => {
    fs.rmSync(tokenStore.storePath());
    assert.throws(() => storage.ensureConfigured(), { status: 503 });
    assert.match(logs.join("\n"), /GOOGLE_REFRESH_TOKEN/);
    tokenStore.write({ refreshToken: REFRESH });
    delete process.env.GOOGLE_DRIVE_FOLDER_ID;
    assert.throws(() => storage.ensureConfigured(), { status: 503 });
    assert.equal(calls.length, 0);
    assertNoSecrets(logs);
  });
});

test("un invalid_grant al renovar se comunica sin revelar detalles", async () => {
  await withDrive(() => json({}), async ({ logs }) => {
    drive.resetAccessTokenCache();
    await assert.rejects(storage.uploadObject(KEY, PDF, "application/pdf"), error => {
      assert.equal(error.status, 503);
      assert.match(error.message, /volver a autorizar Google Drive/);
      assert.ok(!error.message.includes(REFRESH) && !error.message.includes(CLIENT_SECRET));
      return true;
    });
    assert.match(logs.join("\n"), /status=400.*codigo=invalid_grant/);
    assertNoSecrets(logs);
  }, {}, { refreshTokenResponse: () => json({ error: "invalid_grant", error_description: `${REFRESH} ${CLIENT_SECRET}` }, 400) });
});

test("una carpeta inaccesible produce un mensaje claro y seguro", async () => {
  await withDrive(() => json({ id: "archivoSubido123" }), async ({ logs }) => {
    await assert.rejects(storage.uploadObject(KEY, PDF, "application/pdf"), error => {
      assert.equal(error.status, 503);
      assert.match(error.message, /no puede acceder a la carpeta configurada/);
      return true;
    });
    assertNoSecrets(logs);
  }, {}, { folderAccessResponse: () => json({ error: { status: "NOT_FOUND", errors: [{ reason: "notFound" }] } }, 404) });
});

test("un 403 o un fallo de red de Google se traduce a 503 genérico y distingue el origen", async () => {
  await withDrive(() => json({ error: { code: 403, message: `Bearer ${ACCESS}`, errors: [{ reason: "storageQuotaExceeded" }] } }, 403), async ({ logs }) => {
    await assert.rejects(storage.uploadObject(KEY, PDF, "application/pdf"), error => {
      assert.equal(error.status, 503);
      assert.ok(!error.message.includes(ACCESS));
      return true;
    });
    assert.match(logs.join("\n"), /operacion=subida proveedor=gdrive host=www\.googleapis\.com status=403 respuesta=json codigo=storageQuotaExceeded/);
    assertNoSecrets(logs);
  });
  await withDrive(() => { throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("getaddrinfo https://www.googleapis.com?access_token=" + ACCESS), { code: "ENOTFOUND" }) }); }, async ({ logs }) => {
    await assert.rejects(storage.removeObject(KEY), { status: 503 });
    assert.match(logs.join("\n"), /status=n\/a respuesta=ninguna codigo=ENOTFOUND .*origen=red error=TypeError/);
    assertNoSecrets(logs);
  });
});

test("la eliminación borra los archivos encontrados y es idempotente si no existen", async () => {
  await withDrive(call => {
    if (call.method === "DELETE") return new Response(null, { status: 204 });
    return json({ files: [{ id: "archivoSubido123" }] });
  }, async ({ calls }) => {
    await storage.removeObject(KEY);
    const list = calls.find(c => c.url.includes("/drive/v3/files?"));
    assert.equal(new URL(list.url).searchParams.get("q"), `name = '${KEY}' and '${FOLDER}' in parents and trashed = false`);
    assert.ok(calls.some(c => c.method === "DELETE" && c.url.endsWith("/files/archivoSubido123")));
  });
  await withDrive(() => json({ files: [] }), async ({ calls }) => {
    await storage.removeObject(KEY);
    assert.ok(!calls.some(c => c.method === "DELETE"));
  });
});

test("la descarga usa un token firmado de 60 s y transmite el archivo sin exponer credenciales", async () => {
  await withDrive(call => {
    if (call.url.includes("alt=media")) return new Response(PDF, { headers: { "Content-Type": "application/pdf" } });
    return json({ files: [{ id: "archivoSubido123" }] });
  }, async ({ logs }) => {
    const url = await storage.createDownloadUrl(KEY, 'tarea "uno".pdf');
    assert.ok(url.startsWith("https://portal-academico-backend-ensayo.onrender.com/api/archivos-academicos/drive/"));
    const token = url.split("/").pop();
    const res = await request(app).get(`/api/archivos-academicos/drive/${token}`).buffer(true).parse((r, cb) => {
      const chunks = []; r.on("data", c => chunks.push(c)); r.on("end", () => cb(null, Buffer.concat(chunks)));
    });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, PDF);
    assert.equal(res.headers["content-type"], "application/pdf");
    assert.match(res.headers["content-disposition"], /^attachment; filename="download"; filename\*=UTF-8''tarea%20_uno_\.pdf$/);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.ok(!JSON.stringify(res.headers).includes(ACCESS));
    assertNoSecrets(logs);
  });
});

test("una descarga lenta continúa después del timeout de conexión y cancelar cierra el stream", async () => {
  await withDrive(call => {
    if (call.url.includes("alt=media")) {
      let timers = [];
      const body = new ReadableStream({
        start(controller) {
          timers = [
            setTimeout(() => controller.enqueue(PDF), 30),
            setTimeout(() => controller.close(), 40)
          ];
        },
        cancel() { timers.forEach(clearTimeout); }
      });
      return new Response(body, { headers: { "Content-Type": "application/pdf" } });
    }
    return json({ files: [{ id: "archivoSubido123" }] });
  }, async ({ calls }) => {
    const result = await drive.openDownload(KEY);
    const mediaCall = calls.find(call => call.url.includes("alt=media"));
    assert.equal(mediaCall.signal.aborted, false);
    assert.deepEqual(Buffer.from(await new Response(result.body).arrayBuffer()), PDF);
    assert.equal(mediaCall.signal.aborted, false);

    const second = await drive.openDownload(KEY);
    const secondCall = calls.filter(call => call.url.includes("alt=media")).at(-1);
    await second.cancel();
    assert.equal(secondCall.signal.aborted, true);
  });
});

test("los tokens de descarga inválidos, caducados o de sesión se rechazan", async () => {
  await withDrive(() => json({ files: [] }), async () => {
    const login = jwt.sign({ id: 1, rol: "admin" }, process.env.JWT_SECRET, { expiresIn: 60 });
    assert.equal((await request(app).get(`/api/archivos-academicos/drive/${login}`)).status, 401);
    assert.equal((await request(app).get("/api/archivos-academicos/drive/basura")).status, 401);
    const url = await storage.createDownloadUrl(KEY, "a.pdf");
    const expired = jwt.decode(url.split("/").pop());
    assert.ok(expired.exp - expired.iat <= 60);
    const forged = jwt.sign({ k: KEY, n: "a.pdf" }, "otro-secreto", { expiresIn: 60, audience: "gdrive-download" });
    assert.equal((await request(app).get(`/api/archivos-academicos/drive/${forged}`)).status, 401);
    const valid = url.split("/").pop();
    assert.equal((await request(app).get(`/api/archivos-academicos/drive/${valid}`)).status, 404);
  });
});

test("Drive y Supabase están aislados: cada proveedor solo usa su propia configuración", async () => {
  await withDrive(() => json({ id: "archivoSubido123" }), async ({ calls }) => {
    process.env.STORAGE_PROVIDER = "supabase";
    assert.throws(() => storage.ensureConfigured(), { status: 503 });
    process.env.STORAGE_PROVIDER = "gdrive";
    await storage.uploadObject(KEY, PDF, "application/pdf");
    assert.ok(calls.every(c => /googleapis\.com/.test(c.url)));
    process.env.STORAGE_PROVIDER = "otro";
    assert.throws(() => storage.ensureConfigured(), { status: 503 });
  });
});
