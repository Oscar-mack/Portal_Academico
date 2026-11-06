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

function listen(port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, "0.0.0.0");
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}

// Abre el puerto de inmediato (Render lo escanea durante una ventana limitada) y verifica
// PostgreSQL en segundo plano; /ready responde 503 hasta que esa verificación termina.
async function startServer({
  database = db,
  port = PORT,
  exit = process.exit,
  handleSignals = true
} = {}) {
  const connectionSummary = dbConfig.getConnectionSummary();
  const startup = { state: "starting" };
  app.locals.startup = startup;

  try {
    validateProductionConfiguration();
  } catch (error) {
    startup.state = "failed";
    logDatabaseError("Configuración de arranque inválida:", error, connectionSummary);
    exit(1);
    return {};
  }

  let server;
  try {
    server = await listen(port);
  } catch (error) {
    startup.state = "failed";
    console.error("No se pudo abrir el puerto HTTP:", { name: error.name, code: error.code });
    exit(1);
    return {};
  }
  console.log(`Server is running on port ${server.address().port}.`);
  server.keepAliveTimeout = 120000;
  server.headersTimeout = 121000;

  let stopping;
  const shutdown = () => {
    if (stopping) return stopping;
    startup.state = "stopping";
    stopping = new Promise(resolve => {
      server.close(() => {
        Promise.resolve(database.sequelize.close()).catch(() => {}).finally(resolve);
      });
      server.closeIdleConnections?.();
    });
    return stopping;
  };

  if (handleSignals) {
    for (const signal of ["SIGTERM", "SIGINT"]) {
      process.once(signal, () => {
        console.log(`${signal} recibido; cerrando el servidor.`);
        const timer = setTimeout(() => exit(0), 10000);
        timer.unref();
        shutdown().finally(() => exit(0));
      });
    }
  }

  const initialization = (async () => {
    try {
      console.log("Configuracion de PostgreSQL:", getDatabaseLogContext(connectionSummary));
      await database.sequelize.authenticate();
      console.log("Conexion con PostgreSQL verificada correctamente.");
      await database.sequelize.query("SELECT 1 AS database_connection_check");
      console.log("Consulta de prueba a PostgreSQL realizada correctamente.");
      if (isProduction) {
        console.log("Sincronización automática omitida en producción; aplica las migraciones versionadas revisadas antes de usar las nuevas rutas.");
      } else {
        await database.sequelize.sync();
        console.log("Base de datos sincronizada correctamente.");
      }
      // Si llegó una señal de cierre durante la verificación, no se marca como preparado.
      if (startup.state === "starting") startup.state = "ready";
    } catch (error) {
      if (startup.state === "stopping") return;
      startup.state = "failed";
      logDatabaseError("Error al conectar con PostgreSQL:", error, connectionSummary);
      // Un servidor vivo pero sin base de datos no sirve: se sale para que Render lo reinicie.
      exit(1);
    }
  })();

  return { server, initialization, shutdown, startup };
}

process.on("unhandledRejection", reason => {
  console.error("Promesa rechazada sin manejar:", reason instanceof Error ? reason.message : reason);
});
process.on("uncaughtException", error => {
  console.error("Excepción no capturada:", error.message);
  process.exit(1);
});

if (require.main === module) startServer();

module.exports = { startServer };
