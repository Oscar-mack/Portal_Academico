process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "clave-de-pruebas-con-mas-de-32-caracteres";
process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
process.env.CORS_ORIGIN = [
  "https://portal-academico-frontend.onrender.com",
  "https://portal-academico-frontend-ensayo.onrender.com",
  "http://localhost:5173",
  "http://localhost:3000"
].join(",");
delete process.env.CORS_ALLOW_FIGMA_PREVIEWS;

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcryptjs");

const db = require("../app/models");
const app = require("../app");

const RENDER = "https://portal-academico-frontend.onrender.com";
const ENSAYO = "https://portal-academico-frontend-ensayo.onrender.com";
const FIGMA = "https://abc123-figmaiframepreview.figma.site";
const ALLOWED = [
  RENDER,
  ENSAYO,
  "http://localhost:5173",
  "http://localhost:3000"
];
const DENIED = [
  "https://evil.com",
  "https://figma.site",
  "https://evil.com.makeproxy-c.figma.site.evil.com",
  "http://abc123.makeproxy-c.figma.site",
  "https://a.b.makeproxy-m.figma.site"
];

test.before(async () => {
  await db.sequelize.sync({ force: true });
  await db.usuarios.create({
    username: "corsuser",
    email: "cors@prueba.edu",
    password: bcrypt.hashSync("ClaveSegura123", 4),
    rol: "admin"
  });
});

test.after(async () => {
  await db.sequelize.close();
});

for (const origin of ALLOWED) {
  test(`preflight permitido: ${origin}`, async () => {
    const res = await request(app)
      .options("/api/auth/signin")
      .set("Origin", origin)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type,authorization");
    assert.equal(res.status, 204);
    assert.equal(res.headers["access-control-allow-origin"], origin);
    assert.equal(res.headers["access-control-allow-credentials"], "true");
    assert.match(res.headers["access-control-allow-methods"], /PATCH/);
    assert.match(res.headers["access-control-allow-headers"], /Authorization/i);
  });
}

for (const origin of DENIED) {
  test(`origen rechazado: ${origin}`, async () => {
    const res = await request(app)
      .options("/api/auth/signin")
      .set("Origin", origin)
      .set("Access-Control-Request-Method", "POST");
    assert.equal(res.headers["access-control-allow-origin"], undefined);
  });
}

test("CORS_ORIGIN reemplaza valores predeterminados y aísla el frontend de ensayo", async () => {
  const previous = process.env.CORS_ORIGIN;
  process.env.CORS_ORIGIN = ENSAYO;
  try {
    const ensayo = await request(app)
      .options("/api/auth/google/iniciar")
      .set("Origin", ENSAYO)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "authorization");
    assert.equal(ensayo.status, 204);
    assert.equal(ensayo.headers["access-control-allow-origin"], ENSAYO);
    assert.equal(ensayo.headers["access-control-allow-credentials"], "true");

    const produccion = await request(app)
      .options("/api/auth/google/iniciar")
      .set("Origin", RENDER)
      .set("Access-Control-Request-Method", "POST");
    assert.equal(produccion.headers["access-control-allow-origin"], undefined);

    const noAutorizado = await request(app)
      .options("/api/auth/google/iniciar")
      .set("Origin", "https://portal-ajeno.example")
      .set("Access-Control-Request-Method", "POST");
    assert.equal(noAutorizado.headers["access-control-allow-origin"], undefined);
  } finally {
    process.env.CORS_ORIGIN = previous;
  }
});

test("en producción CORS_ORIGIN explícito conserva compatibilidad sin otros orígenes predeterminados", async () => {
  const previousEnvironment = process.env.NODE_ENV;
  const previousOrigins = process.env.CORS_ORIGIN;
  process.env.NODE_ENV = "production";
  process.env.CORS_ORIGIN = RENDER;
  try {
    const production = await request(app)
      .options("/api/auth/signin")
      .set("Origin", RENDER)
      .set("Access-Control-Request-Method", "POST");
    assert.equal(production.headers["access-control-allow-origin"], RENDER);

    const ensayo = await request(app)
      .options("/api/auth/signin")
      .set("Origin", ENSAYO)
      .set("Access-Control-Request-Method", "POST");
    assert.equal(ensayo.headers["access-control-allow-origin"], undefined);

    process.env.CORS_ORIGIN = "";
    const noDefaults = await request(app)
      .options("/api/auth/signin")
      .set("Origin", RENDER)
      .set("Access-Control-Request-Method", "POST");
    assert.equal(noDefaults.headers["access-control-allow-origin"], undefined);
  } finally {
    process.env.NODE_ENV = previousEnvironment;
    process.env.CORS_ORIGIN = previousOrigins;
  }
});

test("CORS nunca refleja wildcard aunque se soliciten credenciales", async () => {
  const previous = process.env.CORS_ORIGIN;
  process.env.CORS_ORIGIN = "*";
  try {
    const response = await request(app)
      .options("/api/auth/signin")
      .set("Origin", "https://portal-academico-frontend-ensayo.onrender.com")
      .set("Access-Control-Request-Method", "POST");
    assert.equal(response.headers["access-control-allow-origin"], undefined);
    assert.notEqual(response.headers["access-control-allow-origin"], "*");
  } finally {
    process.env.CORS_ORIGIN = previous;
  }
});

test("los patrones existentes de Figma solo se habilitan con opt-in explícito", async () => {
  const previous = process.env.CORS_ALLOW_FIGMA_PREVIEWS;
  delete process.env.CORS_ALLOW_FIGMA_PREVIEWS;
  try {
    const denied = await request(app)
      .options("/api/auth/signin")
      .set("Origin", FIGMA)
      .set("Access-Control-Request-Method", "POST");
    assert.equal(denied.headers["access-control-allow-origin"], undefined);

    process.env.CORS_ALLOW_FIGMA_PREVIEWS = "true";
    for (const origin of [
      FIGMA,
      "https://abc123.makeproxy-c.figma.site",
      "https://abc123.makeproxy-m.figma.site"
    ]) {
      const allowed = await request(app)
        .options("/api/auth/signin")
        .set("Origin", origin)
        .set("Access-Control-Request-Method", "POST");
      assert.equal(allowed.status, 204);
      assert.equal(allowed.headers["access-control-allow-origin"], origin);
      assert.equal(allowed.headers["access-control-allow-credentials"], "true");
    }

    const malformed = await request(app)
      .options("/api/auth/signin")
      .set("Origin", "https://evil.com.makeproxy-c.figma.site.evil.com")
      .set("Access-Control-Request-Method", "POST");
    assert.equal(malformed.headers["access-control-allow-origin"], undefined);
  } finally {
    if (previous === undefined) delete process.env.CORS_ALLOW_FIGMA_PREVIEWS;
    else process.env.CORS_ALLOW_FIGMA_PREVIEWS = previous;
  }
});

for (const origin of [RENDER, ENSAYO]) {
  test(`signin y perfil desde ${origin}`, async () => {
    const signin = await request(app)
      .post("/api/auth/signin")
      .set("Origin", origin)
      .send({ username: "corsuser", password: "ClaveSegura123" });
    assert.equal(signin.status, 200);
    assert.equal(signin.headers["access-control-allow-origin"], origin);
    assert.equal(signin.headers["access-control-allow-credentials"], "true");

    const perfil = await request(app)
      .get("/api/auth/perfil")
      .set("Origin", origin)
      .set("Authorization", `Bearer ${signin.body.accessToken || signin.body.token}`);
    assert.equal(perfil.status, 200);
    assert.equal(perfil.headers["access-control-allow-origin"], origin);
  });
}

test("signin desde Figma conserva credenciales cuando el patrón se habilita expresamente", async () => {
  process.env.CORS_ALLOW_FIGMA_PREVIEWS = "true";
  try {
    const signin = await request(app)
      .post("/api/auth/signin")
      .set("Origin", FIGMA)
      .send({ username: "corsuser", password: "ClaveSegura123" });
    assert.equal(signin.status, 200);
    assert.equal(signin.headers["access-control-allow-origin"], FIGMA);
    assert.equal(signin.headers["access-control-allow-credentials"], "true");

    const perfil = await request(app)
      .get("/api/auth/perfil")
      .set("Origin", FIGMA)
      .set("Authorization", `Bearer ${signin.body.accessToken || signin.body.token}`);
    assert.equal(perfil.status, 200);
    assert.equal(perfil.headers["access-control-allow-origin"], FIGMA);
  } finally {
    delete process.env.CORS_ALLOW_FIGMA_PREVIEWS;
  }
});
