const DEVELOPMENT_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000"
];

// Vistas previas dinámicas de Figma Make: un único subdominio, solo HTTPS.
const FIGMA_ORIGIN_PATTERNS = [
  /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?-figmaiframepreview\.figma\.site$/i,
  /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?\.makeproxy-c\.figma\.site$/i,
  /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?\.makeproxy-m\.figma\.site$/i
];

function configuredOrigins() {
  const configured = (process.env.CORS_ORIGIN || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configured.length > 0) {
    return new Set(configured.filter((origin) => origin !== "*"));
  }

  return process.env.NODE_ENV === "production"
    ? new Set()
    : new Set(DEVELOPMENT_ORIGINS);
}

function isOriginAllowed(origin) {
  if (configuredOrigins().has(origin)) return true;
  if ((process.env.CORS_ALLOW_FIGMA_PREVIEWS || "").trim().toLowerCase() !== "true") return false;
  return FIGMA_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

const corsOptions = {
  // Needed for the HttpOnly OAuth state cookie. Origins remain constrained to the allowlist above.
  credentials: true,
  origin(origin, callback) {
    // Sin cabecera Origin (curl, servidor a servidor): CORS no aplica.
    if (!origin) return callback(null, true);
    // Origen no permitido: se omiten las cabeceras CORS y el navegador bloquea la respuesta.
    return callback(null, isOriginAllowed(origin));
  },
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
  maxAge: 600
};

module.exports = { corsOptions, isOriginAllowed };
