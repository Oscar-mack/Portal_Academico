// Las variables inyectadas por Render nunca se sobrescriben con archivos locales.
const path = require("path");
const NODE_ENV = process.env.NODE_ENV || "development";
const isProduction = NODE_ENV === "production";

require("dotenv").config({
  path: path.resolve(__dirname, `.env.${NODE_ENV}`),
  quiet: true
});
require("dotenv").config({
  path: path.resolve(__dirname, ".env"),
  quiet: true
});

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");

const app = express();

console.log(`Ambiente actual: ${NODE_ENV}`);

// ==================== Middlewares globales ====================
var corsOptions = {
  origin: process.env.CORS_ORIGIN || "*"
};
app.use(cors(corsOptions));

// ==================== Base de datos ====================
const db = require("./app/models");
const dbConfig = require("./app/config/db.config");
const pagos = require("./app/controllers/pago.controller.js");

// Stripe verifica la firma con los bytes exactos de la solicitud. Esta ruta
// debe registrarse antes de cualquier parser JSON.
app.post("/api/pagos/webhook", express.raw({ type: "application/json" }), pagos.webhook);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ==================== Ruta de prueba ====================
app.get("/", (req, res) => {
  res.json({ message: "Portal Académico API - Backend funcionando correctamente." });
});

// ==================== Rutas ====================
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

// ==================== Manejo de errores no controlados ====================
app.use((req, res) => {
  res.status(404).send({ message: "Ruta no encontrada." });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).send({ message: "El cuerpo JSON no es válido." });
  }

  console.error(err);
  res.status(500).send({ message: "Ocurrió un error interno en el servidor." });
});

// ==================== Levantar el servidor ====================
const PORT = process.env.PORT || 8080;

function getDatabaseLogContext(connectionSummary) {
  if (isProduction) {
    return {
      environment: NODE_ENV,
      source: connectionSummary.source
    };
  }

  return {
    environment: NODE_ENV,
    databaseUrlExists: Boolean(process.env.DATABASE_URL),
    ...connectionSummary
  };
}

function logDatabaseError(message, error, connectionSummary) {
  console.error(message, {
    name: error.name,
    message: error.message,
    code: error.parent?.code || error.original?.code || error.code,
    detail: error.parent?.detail || error.original?.detail,
    ...getDatabaseLogContext(connectionSummary)
  });

  if (!isProduction) {
    console.error(error);
  }
}

function validateProductionConfiguration() {
  if (!isProduction) {
    return;
  }

  const missing = [];
  const hasIndividualDatabaseConfiguration = [dbConfig.HOST, dbConfig.USER, dbConfig.PASSWORD, dbConfig.DB]
    .every(Boolean);

  if (!process.env.DATABASE_URL && !hasIndividualDatabaseConfiguration) {
    missing.push("DATABASE_URL o DB_HOST, DB_USER, DB_PASSWORD y DB_NAME");
  }
  if (!process.env.JWT_SECRET) {
    missing.push("JWT_SECRET");
  }
  if (!process.env.CORS_ORIGIN) {
    missing.push("CORS_ORIGIN");
  }

  if (missing.length > 0) {
    throw new Error(`Faltan variables de entorno de producción: ${missing.join(", ")}.`);
  }
}

async function startServer() {
  const connectionSummary = dbConfig.getConnectionSummary();

  try {
    validateProductionConfiguration();
    console.log("Configuracion de PostgreSQL:", getDatabaseLogContext(connectionSummary));

    await db.sequelize.authenticate();
    console.log("Conexion con PostgreSQL verificada correctamente.");

    await db.sequelize.query("SELECT 1 AS database_connection_check");
    console.log("Consulta de prueba a PostgreSQL realizada correctamente.");
  } catch (error) {
    logDatabaseError("Error al conectar con PostgreSQL:", error, connectionSummary);
    process.exit(1);
  }

  try {
    await db.sequelize.sync();
    console.log("Base de datos sincronizada correctamente.");

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}.`);
    });
  } catch (error) {
    logDatabaseError("Error al sincronizar PostgreSQL:", error, connectionSummary);
    process.exit(1);
  }
}

startServer();



