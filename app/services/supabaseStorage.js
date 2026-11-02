const { createClient } = require("@supabase/supabase-js");
const { createHash } = require("node:crypto");

// Mismo límite que app/utils/academicFileUpload.js; se repite aquí para evitar una dependencia circular.
const MAX_OBJECT_BYTES = 20 * 1024 * 1024;
// supabase-js no acepta un Readable de Node: el archivo (ya acotado a 20 MiB) se acumula en memoria,
// por lo que el número de subidas simultáneas limita el uso máximo (4 x 20 MiB).
const MAX_CONCURRENT_UPLOADS = 4;
const SIGNED_URL_SECONDS = 60;
const KEY_PATTERN = /^(materials|tasks|submissions)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VARIABLES = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_BUCKET"];

let client;
let clientSignature;
let activeUploads = 0;
const waiting = [];

function configurationError(missing) {
  console.error(`Almacenamiento académico: faltan o son inválidas las variables: ${missing.join(", ")}.`);
  const error = new Error("El almacenamiento académico no está configurado.");
  error.status = 503;
  return error;
}

function configuration() {
  const missing = VARIABLES.filter(name => !(process.env[name] || "").trim());
  if (missing.length) throw configurationError(missing);

  let parsed;
  try {
    parsed = new URL(process.env.SUPABASE_URL.trim());
  } catch {
    throw configurationError(["SUPABASE_URL"]);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw configurationError(["SUPABASE_URL"]);

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY.trim();
  const bucket = process.env.SUPABASE_BUCKET.trim();
  const invalid = [];
  if (/\s/.test(serviceRoleKey)) invalid.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(bucket)) invalid.push("SUPABASE_BUCKET");
  if (invalid.length) throw configurationError(invalid);

  const url = parsed.origin;
  return {
    url,
    serviceRoleKey,
    bucket,
    host: parsed.host,
    keyLength: serviceRoleKey.length,
    signature: createHash("sha256").update(JSON.stringify({ url, serviceRoleKey, bucket })).digest("hex")
  };
}

function getClient() {
  const config = configuration();
  if (!client || clientSignature !== config.signature) {
    client = createClient(config.url, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    clientSignature = config.signature;
    console.log(`Almacenamiento académico: proveedor=supabase host=${config.host} bucket=${config.bucket}`);
  }
  return { storage: client.storage.from(config.bucket) };
}

function ensureConfigured() {
  configuration();
}

// Datos no sensibles para los logs de fallos; nunca lanza.
function origin() {
  try {
    const { host, keyLength } = configuration();
    return { provider: "supabase", host, credentialLengths: { accessKeyId: "n/a", secretAccessKey: keyLength } };
  } catch {
    return { provider: "supabase" };
  }
}

function assertValidKey(key) {
  if (typeof key !== "string" || !KEY_PATTERN.test(key)) {
    const error = new Error("Clave de almacenamiento no válida.");
    error.status = 500;
    throw error;
  }
}

// Los errores de supabase-js se normalizan con la misma forma que usa r2Storage.translateFailure
// ($metadata/$responseBodyText) y sin `status`, para que se registren y traduzcan a un 503 controlado.
function providerFailure(cause) {
  const failure = new Error("Fallo del proveedor de almacenamiento.");
  const status = Number(cause?.status ?? cause?.originalError?.status);
  failure.$metadata = Number.isInteger(status) ? { httpStatusCode: status } : {};
  if (typeof cause?.message === "string") failure.$responseBodyText = cause.message;
  if (typeof cause?.statusCode === "string") failure.code = cause.statusCode;
  return failure;
}

async function guarded(call) {
  let result;
  try {
    result = await call();
  } catch (error) {
    if (error?.status) throw error;
    throw providerFailure(error);
  }
  if (result?.error) throw providerFailure(result.error);
  return result.data;
}

async function acquireUploadSlot() {
  if (activeUploads >= MAX_CONCURRENT_UPLOADS) {
    await new Promise(resolve => waiting.push(resolve));
  } else {
    activeUploads += 1;
  }
}

function releaseUploadSlot() {
  const next = waiting.shift();
  if (next) next();
  else activeUploads -= 1;
}

async function readBounded(body) {
  if (Buffer.isBuffer(body)) {
    if (body.length > MAX_OBJECT_BYTES) throw tooLarge();
    return body;
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of body) {
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += piece.length;
    if (total > MAX_OBJECT_BYTES) {
      body.destroy?.();
      throw tooLarge();
    }
    chunks.push(piece);
  }
  return Buffer.concat(chunks, total);
}

function tooLarge() {
  const error = new Error("El archivo excede el máximo permitido de 20 MiB.");
  error.status = 413;
  return error;
}

async function uploadObject(key, body, contentType) {
  assertValidKey(key);
  const { storage } = getClient();
  await acquireUploadSlot();
  try {
    const content = await readBounded(body);
    await guarded(() => storage.upload(key, content, { contentType, upsert: false, cacheControl: "3600" }));
  } finally {
    releaseUploadSlot();
  }
}

async function removeObject(key) {
  assertValidKey(key);
  const { storage } = getClient();
  await guarded(() => storage.remove([key]));
}

async function createDownloadUrl(key, fileName) {
  assertValidKey(key);
  const { storage } = getClient();
  const data = await guarded(() => storage.createSignedUrl(key, SIGNED_URL_SECONDS));
  const safeFileName = fileName.replace(/[\r\n"]/g, "_");
  // El nombre se añade aquí: supabase-js vuelve a codificar el parámetro `download` (doble codificación).
  return `${data.signedUrl}&download=${encodeURIComponent(safeFileName)}`;
}

module.exports = { createDownloadUrl, ensureConfigured, origin, removeObject, uploadObject };
