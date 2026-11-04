const DB_ERROR_NAMES = new Set([
  "SequelizeConnectionError",
  "SequelizeConnectionRefusedError",
  "SequelizeConnectionTimedOutError",
  "SequelizeHostNotFoundError",
  "SequelizeHostNotReachableError",
  "SequelizeConnectionAcquireTimeoutError"
]);

function isDatabaseUnavailable(error) {
  const code = error?.parent?.code || error?.original?.code || error?.code;
  return DB_ERROR_NAMES.has(error?.name) ||
    ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "57P01", "57P03", "08006", "08001"].includes(code);
}

// Errores con status explícito conservan su mensaje; la caída de PostgreSQL se informa como 503
// y cualquier otro error inesperado no expone detalles internos.
function respondError(res, error, fallbackMessage) {
  if (error?.status) return res.status(error.status).send({ message: error.message || fallbackMessage });
  if (isDatabaseUnavailable(error)) {
    console.error("Base de datos no disponible:", {
      name: error.name,
      code: error.parent?.code || error.original?.code || error.code
    });
    return res.status(503).send({ message: "La base de datos no está disponible temporalmente. Intenta nuevamente." });
  }
  console.error(`${fallbackMessage} (${error?.name || "Error"})`);
  return res.status(500).send({ message: fallbackMessage });
}

module.exports = { respondError, isDatabaseUnavailable };
