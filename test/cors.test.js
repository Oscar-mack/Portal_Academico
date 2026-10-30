process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "clave-de-pruebas-con-mas-de-32-caracteres";
process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcryptjs");

const db = require("../app/models");
const app = require("../app");

const RENDER = "https://portal-academico-frontend.onrender.com";
const FIGMA = "https://abc123-figmaiframepreview.figma.site";
const ALLOWED = [
  RENDER,
  "http://localhost:5173",
  "http://localhost:3000",
  FIGMA,
  "https://abc123.makeproxy-c.figma.site",
  "https://abc123.makeproxy-m.figma.site"
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

for (const origin of [RENDER, FIGMA]) {
  test(`signin y perfil desde ${origin}`, async () => {
    const signin = await request(app)
      .post("/api/auth/signin")
      .set("Origin", origin)
      .send({ username: "corsuser", password: "ClaveSegura123" });
    assert.equal(signin.status, 200);
    assert.equal(signin.headers["access-control-allow-origin"], origin);

    const perfil = await request(app)
      .get("/api/auth/perfil")
      .set("Origin", origin)
      .set("Authorization", `Bearer ${signin.body.accessToken}`);
    assert.equal(perfil.status, 200);
    assert.equal(perfil.headers["access-control-allow-origin"], origin);
  });
}
