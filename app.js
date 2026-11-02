const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const { corsOptions } = require("./app/config/cors.config");
const { QueryTypes } = require("sequelize");
const db = require("./app/models");
const pagos = require("./app/controllers/pago.controller.js");

const app = express();

const REQUIRED_SCHEMA = {
  ciclos_academicos: ["id", "nombre", "fechaInicio", "fechaFin", "estado"],
  periodos_academicos: ["id", "cicloAcademicoId", "nombre", "tipo", "fechaInicio", "fechaFin", "estado"],
  asignacion_cursos: ["periodoAcademicoId", "ofertaCursoId"],
  horario_catedraticos: ["periodoAcademicoId", "ofertaCursoId"],
  nota: ["periodoAcademicoId", "publicadaEn"],
  evaluaciones: ["cursoId", "catedraticoId", "periodoAcademicoId", "puntajeMaximo"],
  calificaciones_evaluacion: ["evaluacionId", "alumnoId", "valor"],
  auditoria_notas: ["notaId", "usuarioId", "valorAnterior", "valorNuevo"],
  tareas: ["cursoId", "catedraticoId", "periodoAcademicoId", "titulo", "fechaPublicacion", "fechaLimite"],
  archivos_academicos: ["storageKey", "nombreOriginal", "mimeType", "sizeBytes", "sha256", "subidoPorUsuarioId"],
  adjuntos_tarea: ["tareaId", "archivoId"],
  materiales_curso: ["cursoId", "catedraticoId", "periodoAcademicoId", "archivoId", "titulo"],
  entregas_tarea: ["tareaId", "alumnoId", "archivoId", "entregadaEn"],
  auditoria_tareas: ["tareaId", "archivoId", "usuarioId", "accion"],
  cargos: ["alumnoId", "montoOriginal", "moneda"],
  pagos: ["cargoId", "stripePaymentIntentId", "metodoPago", "anuladoEn", "anuladoPorId", "motivoAnulacion", "stripeRefundId"],
  eventos_stripe: ["stripeEventId", "tipo", "pagoId"],
  requisitos_solvencia_documentos: ["tipoDocumento", "requiere_solvencia"],
  ofertas_curso: ["cursoId", "catedraticoId", "periodoAcademicoId", "codigoSeccion", "cupoMaximo", "fechaInscripcionInicio", "fechaInscripcionFin"]
};

const REQUIRED_TRIGGERS = [
  "evaluaciones_maximo_biu",
  "calificaciones_evaluacion_validar_biu",
  "evaluaciones_maximo_calificaciones_bu",
  "auditoria_notas_inmutable_bud",
  "tareas_validar_contexto_biu",
  "entregas_tarea_validar_bi",
  "auditoria_tareas_inmutable_bud",
  "pagos_validar_cargo_biu",
  "cargos_proteger_pagos_bu",
  "cargos_no_delete_con_historial_bd",
  "horarios_validar_oferta_biu",
  "asignaciones_validar_oferta_biu"
];

// En PostgreSQL se lee todo el catálogo necesario en pocas consultas (en lugar de una
// describeTable por tabla) para que /ready no dependa de ~20 viajes de ida y vuelta a Neon.
async function loadExistingColumns() {
  const tables = Object.keys(REQUIRED_SCHEMA);
  if (db.sequelize.getDialect() === "postgres") {
    const rows = await db.sequelize.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name IN (:tables)`,
      { replacements: { tables }, type: QueryTypes.SELECT }
    );
    const existing = new Map();
    for (const { table_name: table, column_name: column } of rows) {
      if (!existing.has(table)) existing.set(table, new Set());
      existing.get(table).add(column);
    }
    return existing;
  }

  const queryInterface = db.sequelize.getQueryInterface();
  const existingTables = new Set((await queryInterface.showAllTables()).map(table =>
    typeof table === "string" ? table : table.tableName
  ));
  const existing = new Map();
  for (const table of tables) {
    if (existingTables.has(table)) {
      existing.set(table, new Set(Object.keys(await queryInterface.describeTable(table))));
    }
  }
  return existing;
}

async function findMissingSchema() {
  const existing = await loadExistingColumns();
  const missing = [];

  for (const [table, columns] of Object.entries(REQUIRED_SCHEMA)) {
    if (!existing.has(table)) {
      missing.push(`table:${table}`);
      continue;
    }
    for (const column of columns) {
      if (!existing.get(table).has(column)) missing.push(`column:${table}.${column}`);
    }
  }

  if (db.sequelize.getDialect() === "postgres") {
    const triggers = await db.sequelize.query(
      "SELECT tgname FROM pg_trigger WHERE NOT tgisinternal",
      { type: QueryTypes.SELECT }
    );
    const existingTriggers = new Set(triggers.map(trigger => trigger.tgname));
    for (const trigger of REQUIRED_TRIGGERS) {
      if (!existingTriggers.has(trigger)) missing.push(`trigger:${trigger}`);
    }
  }

  return missing;
}

const readyTimeoutMs = () => Number(process.env.READY_TIMEOUT_MS || 8000);

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`La comprobación de readiness superó ${ms} ms.`);
      error.name = "ReadinessTimeout";
      reject(error);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

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
    const missingSchema = await withTimeout((async () => {
      await db.sequelize.query("SELECT 1");
      return findMissingSchema();
    })(), readyTimeoutMs());
    if (missingSchema.length > 0) {
      // Solo nombres de objetos de esquema (sin datos ni credenciales): permite ver en los
      // logs de Render qué migración falta cuando el health check falla.
      console.error("Readiness: esquema incompleto.", { missingSchema });
      return res.status(503).json({
        status: "unavailable",
        checks: { database: "ok", schema: "incomplete" },
        missingSchema
      });
    }
    return res.json({ status: "ready", checks: { database: "ok", schema: "ok" } });
  } catch (error) {
    console.error("Readiness check failed:", {
      name: error.name,
      message: error.message,
      code: error.parent?.code || error.original?.code || error.code
    });
    return res.status(503).json({
      status: "unavailable",
      checks: { database: "unavailable", schema: "unknown" }
    });
  }
});

require("./app/routes/auth.routes")(app);
require("./app/routes/usuario.routes")(app);
require("./app/routes/gradoCarrera.routes")(app);
require("./app/routes/catedratico.routes")(app);
require("./app/routes/alumno.routes")(app);
require("./app/routes/curso.routes")(app);
require("./app/routes/asignacionCurso.routes")(app);
require("./app/routes/ofertaCurso.routes")(app);
require("./app/routes/horarioCatedratico.routes")(app);
require("./app/routes/padreAlumno.routes")(app);
require("./app/routes/nota.routes")(app);
require("./app/routes/reporte.routes")(app);
require("./app/routes/pago.routes")(app);
require("./app/routes/cicloAcademico.routes")(app);
require("./app/routes/periodoAcademico.routes")(app);
require("./app/routes/evaluacion.routes")(app);
require("./app/routes/tarea.routes")(app);
require("./app/routes/materialCurso.routes")(app);
require("./app/routes/archivoAcademico.routes")(app);
require("./app/routes/cargo.routes")(app);
require("./app/routes/dashboard.routes")(app);
require("./app/routes/requisitoSolvencia.routes")(app);

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
