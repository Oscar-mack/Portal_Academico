const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const { corsOptions } = require("./app/config/cors.config");
const db = require("./app/models");
const pagos = require("./app/controllers/pago.controller.js");

const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use(cors(corsOptions));

// Stripe verifica la firma con los bytes exactos de la solicitud. Esta ruta
// debe registrarse antes de cualquier parser JSON.
app.post("/api/pagos/webhook", express.raw({ type: "application/json" }), pagos.webhook);
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

// Limita intentos de login para dificultar ataques de fuerza bruta.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LOGIN_RATE_LIMIT || 20),
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "test" && !process.env.LOGIN_RATE_LIMIT,
  message: { message: "Demasiados intentos de inicio de sesión. Intenta más tarde." }
});
app.use("/api/auth/signin", loginLimiter);

app.get("/", (req, res) => {
  res.json({ message: "Portal Académico API - Backend funcionando correctamente." });
});

// Liveness: el proceso responde. Readiness: además hay conexión con la base de datos.
app.get("/health", (req, res) => res.json({ status: "ok" }));
app.get("/ready", async (req, res) => {
  try {
    await db.sequelize.query("SELECT 1");
    res.json({ status: "ready" });
  } catch (error) {
    res.status(503).json({ status: "unavailable" });
  }
});

require("./app/routes/auth.routes")(app);
require("./app/routes/usuario.routes")(app);
require("./app/routes/gradoCarrera.routes")(app);
require("./app/routes/catedratico.routes")(app);
require("./app/routes/alumno.routes")(app);
require("./app/routes/curso.routes")(app);
require("./app/routes/asignacionCurso.routes")(app);
require("./app/routes/horarioCatedratico.routes")(app);
require("./app/routes/padreAlumno.routes")(app);
require("./app/routes/nota.routes")(app);
require("./app/routes/reporte.routes")(app);
require("./app/routes/pago.routes")(app);

app.use((req, res) => {
  res.status(404).send({ message: "Ruta no encontrada." });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).send({ message: "El cuerpo JSON no es válido." });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).send({ message: "El cuerpo de la solicitud es demasiado grande." });
  }

  // Solo se registra el mensaje, nunca el cuerpo de la petición (datos personales/contraseñas).
  console.error("Error no controlado:", err.message);
  res.status(500).send({ message: "Ocurrió un error interno en el servidor." });
});

module.exports = app;
