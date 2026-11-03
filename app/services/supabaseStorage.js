const { createClient } = require("@supabase/supabase-js");
const { createHash } = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");

// Mismo límite que app/utils/academicFileUpload.js; se repite aquí para evitar una dependencia circular.
const MAX_OBJECT_BYTES = 20 * 1024 * 1024;
// supabase-js no acepta un Readable de Node: el archivo (ya acotado a 20 MiB) se acumula en memoria,
// por lo que el número de subidas simultáneas limita el uso máximo (4 x 20 MiB).
const MAX_CONCURRENT_UPLOADS = 4;
const SIGNED_URL_SECONDS = 60;
const KEY_PATTERN = /^(materials|tasks|submissions)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VARIABLES = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_BUCKET"];

const MAX_ERROR_BODY_CHARS = 400;
// Cada operación abre su propio contexto para asociar el cuerpo de error a la llamada correcta.
const errorContext = new AsyncLocalStorage();

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

// supabase-js descarta el cuerpo de los errores que no son JSON. Se lee un clon (como máximo
// 400 caracteres) para conservarlo; la respuesta original llega intacta al SDK.
async function readErrorSnippet(response) {
  const reader = response.clone().body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (text.length < MAX_ERROR_BODY_CHARS) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    // Sin await: en una rama de tee() la cancelación solo se resuelve cuando el SDK consume la otra.
    reader.cancel().catch(() => {});
  }
  return text.slice(0, MAX_ERROR_BODY_CHARS);
}

function createStorageFetch(serviceRoleKey, fetchImpl = (...args) => globalThis.fetch(...args)) {
  return async (input, init) => {
    const requestHeaders = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    if (
      serviceRoleKey.startsWith("sb_secret_") &&
      requestHeaders.get("authorization") === `Bearer ${serviceRoleKey}`
    ) {
      requestHeaders.delete("authorization");
      init = { ...init, headers: requestHeaders };
    }

    const response = await fetchImpl(input, init);
    const context = errorContext.getStore();
    if (context && !response.ok && !/json/i.test(response.headers.get("content-type") || "")) {
      try {
        context.body = await readErrorSnippet(response);
      } catch {
        // El diagnóstico es opcional: un fallo al leer el clon no debe afectar a la operación.
      }
    }
    return response;
  };
}

function getClient() {
  const config = configuration();
  if (!client || clientSignature !== config.signature) {
    client = createClient(config.url, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: createStorageFetch(config.serviceRoleKey) }
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

const NETWORK_CODE = /^(E[A-Z0-9]{3,20}|UND_ERR_[A-Z_]{2,40}|ERR_TLS_[A-Z_]{2,40}|ERR_SSL_[A-Z_]{2,40}|CERT_[A-Z_]{2,40}|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_[A-Z_]{2,40}|SELF_SIGNED_CERT_IN_CHAIN)$/;
const NETWORK_NAMES = new Set(["AbortError", "TimeoutError"]);

// Recorre la cadena de causas (hasta 5 niveles) y devuelve solo códigos y nombres con forma segura;
// nunca mensajes, que pueden contener URLs o cabeceras.
function inspectCauseChain(cause) {
  let code;
  let name;
  let thrown = cause?.originalError ?? cause;
  let current = thrown;
  for (let depth = 0; current && typeof current === "object" && depth < 5; depth += 1) {
    if (!code && typeof current.code === "string" && NETWORK_CODE.test(current.code)) code = current.code;
    if (!name && typeof current.name === "string" && /^[A-Za-z]{1,40}$/.test(current.name)) name = current.name;
    current = current.cause;
  }
  const fetchFailed = thrown instanceof TypeError && thrown.message === "fetch failed";
  return { code, name: typeof thrown?.name === "string" && /^[A-Za-z]{1,40}$/.test(thrown.name) ? thrown.name : name, network: Boolean(code) || fetchFailed || NETWORK_NAMES.has(thrown?.name) };
}

// Los errores de supabase-js se normalizan con la misma forma que usa r2Storage.translateFailure
// ($metadata/$responseBodyText) y sin `status`, para que se registren y traduzcan a un 503 controlado.
// $origin distingue: http (hubo respuesta), red (fetch falló sin respuesta) o sdk (error interno).
function providerFailure(cause, body) {
  const failure = new Error("Fallo del proveedor de almacenamiento.");
  const status = Number(cause?.status ?? cause?.originalError?.status);
  const hasStatus = Number.isInteger(status);
  failure.$metadata = hasStatus ? { httpStatusCode: status } : {};
  if (hasStatus) {
    failure.$origin = "http";
    if (body) failure.$responseBodyText = body;
    else if (typeof cause?.message === "string") failure.$responseBodyText = cause.message;
    if (typeof cause?.statusCode === "string") failure.code = cause.statusCode;
    return failure;
  }
  const { code, name, network } = inspectCauseChain(cause);
  failure.$origin = network ? "red" : "sdk";
  if (code) failure.code = code;
  if (name) failure.$errorName = name;
  return failure;
}

async function guarded(call) {
  const context = { body: "" };
  let result;
  try {
    result = await errorContext.run(context, call);
  } catch (error) {
    if (error?.status) throw error;
    throw providerFailure(error, context.body);
  }
  if (result?.error) throw providerFailure(result.error, context.body);
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

module.exports = { createDownloadUrl, createStorageFetch, ensureConfigured, origin, removeObject, uploadObject };
