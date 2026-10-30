const DEFAULT_ORIGINS = [
  "https://portal-academico-frontend.onrender.com",
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
  const extra = (process.env.CORS_ORIGIN || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter((origin) => origin && origin !== "*");
  return new Set([...DEFAULT_ORIGINS, ...extra]);
}

function isOriginAllowed(origin) {
  return configuredOrigins().has(origin) || FIGMA_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

const corsOptions = {
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
