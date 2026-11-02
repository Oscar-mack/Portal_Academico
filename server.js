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

const db = require("./app/models");
const dbConfig = require("./app/config/db.config");
const app = require("./app");

console.log(`Ambiente actual: ${NODE_ENV}`);

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
  if (!process.env.CORS_ORIGIN || process.env.CORS_ORIGIN === "*") {
    missing.push("CORS_ORIGIN (dominio explícito, no \"*\")");
  }
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    missing.push("JWT_SECRET (mínimo 32 caracteres)");
  }
  for (const key of ["APP_URL", "FRONTEND_URL"]) {
    if (process.env[key]) {
      try {
        if (new URL(process.env[key]).protocol !== "https:") {
          missing.push(`${key} (debe usar https://)`);
        }
      } catch {
        missing.push(`${key} (debe ser una URL válida)`);
      }
    }
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
    if (isProduction) {
      console.log("Sincronización automática omitida en producción; aplica las migraciones versionadas revisadas antes de usar las nuevas rutas.");
    } else {
      await db.sequelize.sync();
      console.log("Base de datos sincronizada correctamente.");
    }

    // Render enruta por 0.0.0.0 y su proxy mantiene conexiones largas: el keep-alive de Node
    // debe superar el suyo para evitar 502 intermitentes.
    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server is running on port ${PORT}.`);
    });
    server.keepAliveTimeout = 120000;
    server.headersTimeout = 121000;

    process.once("SIGTERM", () => {
      console.log("SIGTERM recibido; cerrando el servidor.");
      server.close(() => db.sequelize.close().finally(() => process.exit(0)));
      setTimeout(() => process.exit(0), 10000).unref();
    });
  } catch (error) {
    logDatabaseError("Error al sincronizar PostgreSQL:", error, connectionSummary);
    process.exit(1);
  }
}

process.on("unhandledRejection", reason => {
  console.error("Promesa rechazada sin manejar:", reason instanceof Error ? reason.message : reason);
});
process.on("uncaughtException", error => {
  console.error("Excepción no capturada:", error.message);
  process.exit(1);
});

startServer();
