const {
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client
} = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { createHash } = require("node:crypto");
const supabaseStorage = require("./supabaseStorage");

let client;
let clientSignature;

function storageError(message, detail) {
  if (detail) console.error(`Almacenamiento académico: ${detail}`);
  const error = new Error(message);
  error.status = 503;
  return error;
}

function notConfigured(missing) {
  return storageError(
    "El almacenamiento académico no está configurado.",
    `faltan o son inválidas las variables: ${missing.join(", ")}.`
  );
}

const SUPABASE_S3_PATH = "/storage/v1/s3";
const SAFE_TOKEN = /^[A-Za-z0-9_. -]{1,60}$/;
const NETWORK_CODES = new Set([
  "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "EPIPE",
  "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
]);
const NETWORK_NAMES = new Set(["TimeoutError", "RequestTimeout", "NetworkingError"]);

function safeToken(value) {
  if (typeof value !== "string") return undefined;
  const token = value.trim();
  return SAFE_TOKEN.test(token) ? token : undefined;
}

function isStorageFailure(error) {
  if (!error || typeof error !== "object" || error.status) return false;
  return Boolean(
    error.$metadata || error.$response || error.$fault ||
    NETWORK_CODES.has(error.code) || NETWORK_NAMES.has(error.name) ||
    /^@aws-sdk/.test(String(error.message))
  );
}

// Extrae solo datos no sensibles: nunca el cuerpo, las cabeceras ni las URL de la petición.
function describeFailure(error) {
  const response = error.$response;
  const status = response?.statusCode ?? error.$metadata?.httpStatusCode;
  const contentType = String(response?.headers?.["content-type"] || "").toLowerCase();
  const body = typeof error.$responseBodyText === "string" ? error.$responseBodyText.trimStart() : "";
  let kind = "ninguna";
  let code;
  if (body || contentType) {
    if (body.startsWith("<!") || body.toLowerCase().startsWith("<html") || contentType.includes("html")) kind = "html";
    else if (body.startsWith("{") || body.startsWith("[") || contentType.includes("json")) kind = "json";
    else if (body.startsWith("<") || contentType.includes("xml")) kind = "xml";
    else kind = "texto";
  }
  if (kind === "json") {
    try {
      const parsed = JSON.parse(body);
      code = safeToken(parsed?.error) || safeToken(parsed?.code);
    } catch {
      // Cuerpo JSON truncado o inválido: basta con indicar el tipo.
    }
  }
  if (!code && error.name && error.name !== "Error") code = safeToken(error.name);
  if (!code) code = safeToken(error.code);
  return { status, kind, code, requestId: safeToken(error.$metadata?.requestId) };
}

const SENSITIVE_MARKERS = /authorization|bearer|cookie|signature|credential|x-amz|secret|token|password|apikey|api-key|eyJ|AKIA|https?:\/\/|[A-Za-z0-9+/_=-]{24,}/i;

// Devuelve un fragmento del cuerpo solo si es seguro; ante la duda devuelve null.
function safeBodySnippet(error) {
  const raw = typeof error.$responseBodyText === "string" ? error.$responseBodyText : "";
  const text = raw.slice(0, 400).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text || SENSITIVE_MARKERS.test(text)) return null;
  const configured = ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]
    .map(name => (process.env[name] || "").trim())
    .filter(value => value.length >= 4);
  if (configured.some(value => text.includes(value))) return null;
  return text.slice(0, 200);
}

const debugBodyEnabled = () => ["true", "1"].includes((process.env.STORAGE_DEBUG_BODY || "").trim().toLowerCase());

function translateFailure(error, operation, { provider, host, credentialLengths }) {
  if (!isStorageFailure(error)) return error;
  const { status, kind, code, requestId } = describeFailure(error);
  let debug = "";
  if (debugBodyEnabled()) {
    // Diagnóstico temporal: nunca registra valores de credenciales, solo sus longitudes.
    const lengths = credentialLengths ? ` longitudClaveId=${credentialLengths.accessKeyId} longitudSecreto=${credentialLengths.secretAccessKey}` : "";
    debug = lengths;
    if (kind === "texto" && status >= 400 && status < 500) {
      const snippet = safeBodySnippet(error);
      debug += snippet ? ` cuerpo="${snippet}"` : " cuerpo=omitido";
    }
  }
  console.error(
    `Almacenamiento académico: fallo operacion=${operation} proveedor=${provider}` +
    `${host ? ` host=${host}` : ""} status=${status ?? "n/a"} respuesta=${kind} codigo=${code ?? "n/a"}` +
    `${requestId ? ` requestId=${requestId}` : ""}${debug}`
  );
  const failure = new Error("El almacenamiento académico no está disponible o devolvió una respuesta inesperada.");
  failure.status = 503;
  return failure;
}

function configurationSignature(provider, bucket, clientOptions) {
  return createHash("sha256")
    .update(JSON.stringify({ provider, bucket, clientOptions }))
    .digest("hex");
}

function selectedProvider() {
  const raw = (process.env.STORAGE_PROVIDER || "").trim().toLowerCase();
  if (!raw) return "r2";
  if (raw === "r2" || raw === "s3" || raw === "supabase") return raw;
  throw storageError("Proveedor de almacenamiento no válido.", "STORAGE_PROVIDER no es válido (use r2, s3 o supabase).");
}

function r2Configuration() {
  const names = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"];
  const missing = names.filter(name => !process.env[name]);
  if (missing.length) throw notConfigured(missing);
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = process.env;
  const clientOptions = {
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    region: "auto",
    forcePathStyle: true,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY }
  };
  return {
    provider: "r2",
    bucket: R2_BUCKET_NAME,
    signature: configurationSignature("r2", R2_BUCKET_NAME, clientOptions),
    clientOptions
  };
}

function s3Configuration() {
  const names = ["S3_ENDPOINT", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET"];
  const missing = names.filter(name => !(process.env[name] || "").trim());
  if (missing.length) throw notConfigured(missing);
  const rawEndpoint = process.env.S3_ENDPOINT.trim();
  let parsed;
  try {
    parsed = new URL(rawEndpoint);
  } catch {
    throw notConfigured(["S3_ENDPOINT"]);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw notConfigured(["S3_ENDPOINT"]);
  let endpoint = rawEndpoint;
  if (/(^|\.)supabase\.(co|in)$/i.test(parsed.hostname)) {
    // El host raíz de Supabase sirve la API REST (JSON); la API S3 solo vive bajo este path.
    if (parsed.pathname.replace(/\/+$/, "") !== SUPABASE_S3_PATH) {
      throw storageError(
        "El almacenamiento académico no está configurado.",
        `S3_ENDPOINT de Supabase debe terminar en ${SUPABASE_S3_PATH}.`
      );
    }
    endpoint = `${parsed.origin}${SUPABASE_S3_PATH}`;
  }
  const { S3_REGION, S3_BUCKET } = process.env;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY.trim();
  // Un espacio o salto de línea dentro de la clave produce una cabecera Authorization inválida.
  const malformed = [["S3_ACCESS_KEY_ID", accessKeyId], ["S3_SECRET_ACCESS_KEY", secretAccessKey]]
    .filter(([, value]) => /\s/.test(value))
    .map(([name]) => name);
  if (malformed.length) throw notConfigured(malformed);
  const bucket = S3_BUCKET.trim();
  const clientOptions = {
    endpoint,
    region: S3_REGION.trim(),
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: { accessKeyId, secretAccessKey }
  };
  return {
    provider: "s3",
    credentialLengths: { accessKeyId: accessKeyId.length, secretAccessKey: secretAccessKey.length },
    bucket,
    host: parsed.host,
    signature: configurationSignature("s3", bucket, clientOptions),
    clientOptions
  };
}

// Cada proveedor lee únicamente su propio grupo de variables; nunca se mezclan.
function configuration() {
  return selectedProvider() === "s3" ? s3Configuration() : r2Configuration();
}

function getClient() {
  const config = configuration();
  if (!client || clientSignature !== config.signature) {
    client = new S3Client(config.clientOptions);
    clientSignature = config.signature;
    console.log(`Almacenamiento académico: proveedor=${config.provider}${config.host ? ` host=${config.host}` : ""} bucket=${config.bucket}`);
  }
  return {
    client,
    bucket: config.bucket,
    provider: config.provider,
    host: config.host,
    credentialLengths: config.credentialLengths
  };
}

function ensureConfigured() {
  if (selectedProvider() === "supabase") return supabaseStorage.ensureConfigured();
  configuration();
}

async function viaSupabase(operation, call) {
  try {
    return await call();
  } catch (error) {
    throw translateFailure(error, operation, supabaseStorage.origin());
  }
}

async function uploadObject(key, body, contentType) {
  if (selectedProvider() === "supabase") return viaSupabase("subida", () => supabaseStorage.uploadObject(key, body, contentType));
  const { client: s3, bucket, ...origin } = getClient();
  try {
    await new Upload({
      client: s3,
      params: { Bucket: bucket, Key: key, Body: body, ContentType: contentType },
      queueSize: 1,
      partSize: 5 * 1024 * 1024,
      leavePartsOnError: false
    }).done();
  } catch (error) {
    throw translateFailure(error, "subida", origin);
  }
}

async function removeObject(key) {
  if (selectedProvider() === "supabase") return viaSupabase("eliminacion", () => supabaseStorage.removeObject(key));
  const { client: s3, bucket, ...origin } = getClient();
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    throw translateFailure(error, "eliminacion", origin);
  }
}

async function createDownloadUrl(key, fileName) {
  if (selectedProvider() === "supabase") return viaSupabase("firma", () => supabaseStorage.createDownloadUrl(key, fileName));
  const { client: s3, bucket, ...origin } = getClient();
  const safeFileName = fileName.replace(/[\r\n"]/g, "_");
  const disposition = `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(safeFileName)}`;
  try {
    return await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentDisposition: disposition
      }),
      { expiresIn: 60 }
    );
  } catch (error) {
    throw translateFailure(error, "firma", origin);
  }
}

module.exports = { createDownloadUrl, ensureConfigured, getClient, removeObject, uploadObject };
