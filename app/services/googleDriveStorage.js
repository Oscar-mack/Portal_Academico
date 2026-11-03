const jwt = require("jsonwebtoken");
const { createHash, createHmac, randomBytes } = require("node:crypto");
const tokenStore = require("./googleTokenStore");
const ROLES = require("../config/roles");

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_URL = "https://www.googleapis.com/drive/v3";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const GOOGLE_HOST = "www.googleapis.com";
const CALLBACK_PATH = "/api/auth/google/callback";
const REQUEST_TIMEOUT_MS = 20000;
const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_COOKIE_TTL_MS = 30 * 60 * 1000;
const MAX_PENDING_STATES = 50;
const DOWNLOAD_SECONDS = 60;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const MAX_CONCURRENT_UPLOADS = 1;
const KEY_PATTERN = /^(materials|tasks|submissions)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FOLDER_ID_PATTERN = /^[A-Za-z0-9_-]{10,100}$/;
const SAFE_TOKEN = /^[A-Za-z0-9_. -]{1,60}$/;
const NETWORK_CODE = /^(E[A-Z0-9]{3,20}|UND_ERR_[A-Z_]{2,40}|ERR_TLS_[A-Z_]{2,40}|CERT_[A-Z_]{2,40}|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_[A-Z_]{2,40})$/;

const pendingStates = new Map();
const launchTickets = new Map();
const LAUNCH_TTL_MS = 60 * 1000;
let accessCache = null;
let activeUploads = 0;

const env = name => (process.env[name] || "").trim();

function configurationError(missing) {
  console.error(`Almacenamiento académico: faltan o son inválidas las variables: ${missing.join(", ")}.`);
  const error = new Error("El almacenamiento académico no está configurado.");
  error.status = 503;
  return error;
}

function clientError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function oauthConfiguration() {
  const invalid = [];
  const clientId = env("GOOGLE_CLIENT_ID");
  const clientSecret = env("GOOGLE_CLIENT_SECRET");
  const redirectUri = env("GOOGLE_REDIRECT_URI");
  if (!clientId || /\s/.test(clientId)) invalid.push("GOOGLE_CLIENT_ID");
  if (!clientSecret || /\s/.test(clientSecret)) invalid.push("GOOGLE_CLIENT_SECRET");
  try {
    const parsed = new URL(redirectUri);
    const local = ["localhost", "127.0.0.1"].includes(parsed.hostname);
    const protocolOk = parsed.protocol === "https:" || (local && parsed.protocol === "http:");
    if (!protocolOk || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== CALLBACK_PATH) {
      invalid.push("GOOGLE_REDIRECT_URI");
    }
  } catch {
    invalid.push("GOOGLE_REDIRECT_URI");
  }
  if (invalid.length) throw configurationError(invalid);
  return { clientId, clientSecret, redirectUri };
}

function refreshToken() {
  if (env("GOOGLE_REFRESH_TOKEN")) {
    const error = new Error("GOOGLE_REFRESH_TOKEN en texto plano está deshabilitada; configura GOOGLE_REFRESH_TOKEN_ENC cifrado.");
    error.status = 503;
    throw error;
  }
  try {
    return tokenStore.read().refreshToken || "";
  } catch (error) {
    const failure = new Error(error.code === "TOKEN_STORE_CORRUPT"
      ? "El refresh token cifrado no se pudo descifrar; verifica GOOGLE_TOKEN_ENCRYPTION_KEY."
      : "No se pudo leer el refresh token cifrado de Google Drive.");
    failure.status = 503;
    failure.code = error.code;
    throw failure;
  }
}

function resetAccessTokenCache() {
  accessCache = null;
}

function folderId() {
  let storedId = "";
  try {
    storedId = tokenStore.read().folderId || "";
  } catch (error) {
    const failure = new Error(error.code === "TOKEN_STORE_CORRUPT"
      ? "El almacén cifrado de Google Drive no se pudo descifrar; verifica GOOGLE_TOKEN_ENCRYPTION_KEY."
      : "No se pudo leer el almacén cifrado de Google Drive.");
    failure.status = 503;
    failure.code = error.code;
    throw failure;
  }
  const id = env("GOOGLE_DRIVE_FOLDER_ID") || storedId;
  return FOLDER_ID_PATTERN.test(id || "") ? id : "";
}

function maxFileBytes() {
  const { MAX_FILE_BYTES } = require("../utils/academicFileUpload");
  const configured = Number(env("GOOGLE_DRIVE_MAX_FILE_BYTES"));
  return Number.isInteger(configured) && configured > 0 ? Math.min(configured, MAX_FILE_BYTES) : DEFAULT_MAX_BYTES;
}

function ensureConfigured() {
  oauthConfiguration();
  if (!tokenStore.encryptionKeyConfigured()) throw configurationError(["GOOGLE_TOKEN_ENCRYPTION_KEY"]);
  const missing = [];
  if (!refreshToken()) missing.push("GOOGLE_REFRESH_TOKEN (autorización de Google pendiente)");
  if (!folderId()) missing.push("GOOGLE_DRIVE_FOLDER_ID");
  if (missing.length) throw configurationError(missing);
}

function origin() {
  return { provider: "gdrive", host: GOOGLE_HOST };
}

function safeToken(value) {
  return typeof value === "string" && SAFE_TOKEN.test(value.trim()) ? value.trim() : undefined;
}

// Los errores usan la forma $metadata/$responseBodyText que r2Storage.translateFailure ya sabe
// registrar y convertir en un 503 genérico. Solo se conservan códigos con forma segura, nunca cuerpos.
function failure(status, code, kind, name) {
  const error = new Error("Fallo del proveedor de almacenamiento.");
  error.$metadata = status ? { httpStatusCode: status } : {};
  error.$origin = kind;
  if (code) error.$responseBodyText = JSON.stringify({ error: code });
  if (code) error.$gdriveCode = code;
  if (name) error.$errorName = name;
  return error;
}

function networkFailure(cause) {
  let code;
  let name;
  for (let current = cause, depth = 0; current && typeof current === "object" && depth < 5; depth += 1) {
    if (!code && typeof current.code === "string" && NETWORK_CODE.test(current.code)) code = current.code;
    if (!name && typeof current.name === "string" && /^[A-Za-z]{1,40}$/.test(current.name)) name = current.name;
    current = current.cause;
  }
  const error = failure(undefined, undefined, "red", name);
  if (code) error.code = code;
  return error;
}

async function googleFetch(url, init = {}, { returnAbort = false } = {}) {
  let response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    response = await globalThis.fetch(url, { ...init, signal: controller.signal });
  } catch (cause) {
    throw networkFailure(cause);
  } finally {
    clearTimeout(timeout);
  }
  if (response.ok) return returnAbort ? { response, abort: () => controller.abort() } : response;
  let code;
  try {
    const body = await response.json();
    code = safeToken(body?.error?.errors?.[0]?.reason) || safeToken(body?.error?.status) ||
      (typeof body?.error === "string" ? safeToken(body.error) : undefined);
  } catch {
    // Cuerpo no JSON: basta con el estado HTTP.
  }
  throw failure(response.status, code, "http");
}

async function accessToken() {
  const token = refreshToken();
  if (!token) throw configurationError(["GOOGLE_REFRESH_TOKEN (autorización de Google pendiente)"]);
  const fingerprint = createHash("sha256").update(token).digest("hex");
  if (accessCache && accessCache.fingerprint === fingerprint && accessCache.expiresAt > Date.now() + 60000) {
    return accessCache.value;
  }
  const { clientId, clientSecret } = oauthConfiguration();
  let response;
  try {
    response = await googleFetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId, client_secret: clientSecret, refresh_token: token, grant_type: "refresh_token"
      })
    });
  } catch (error) {
    if (error.$gdriveCode === "invalid_grant") error.$gdriveReauthorizationRequired = true;
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (typeof data.access_token !== "string" || !data.access_token) throw failure(undefined, undefined, "sdk", "InvalidTokenResponse");
  accessCache = { fingerprint, value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3000) * 1000 };
  return accessCache.value;
}

async function driveFetch(url, init = {}, options = {}) {
  const token = await accessToken();
  return googleFetch(
    url,
    { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } },
    options
  );
}

function purgeStates() {
  const now = Date.now();
  for (const [state, entry] of pendingStates) if (entry.expiresAt <= now) pendingStates.delete(state);
  while (pendingStates.size >= MAX_PENDING_STATES) pendingStates.delete(pendingStates.keys().next().value);
}

function stateCookieName(state) {
  return typeof state === "string" && /^[a-f0-9]{64}$/.test(state) ? `gdrive_oauth_${state}` : "";
}

function adminCookieName(state) {
  const name = stateCookieName(state);
  return name ? `${name}_admin` : "";
}

function validAdminProof(proof, state, userId) {
  try {
    const payload = jwt.verify(proof, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
      audience: "gdrive-oauth-session"
    });
    return payload.state === state && payload.rol === ROLES.ADMIN && String(payload.id) === String(userId);
  } catch {
    return false;
  }
}

function cancelAuthorization({ state, cookieValue, adminProof }) {
  const entry = typeof state === "string" ? pendingStates.get(state) : undefined;
  if (!entry || entry.expiresAt <= Date.now() || !cookieValue ||
    createHash("sha256").update(cookieValue).digest("hex") !== entry.cookieHash ||
    !validAdminProof(adminProof, state, entry.userId)) {
    throw clientError(400, "La solicitud de autorización no es válida o expiró. Inicia el proceso de nuevo.");
  }
  pendingStates.delete(state);
}

function authorizationProof(state, cookieValue, adminProof) {
  if (!stateCookieName(state) || !cookieValue) return null;
  try {
    const payload = jwt.verify(adminProof, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
      audience: "gdrive-oauth-session"
    });
    const cookieHash = createHash("sha256").update(cookieValue).digest("hex");
    if (payload.state !== state || payload.rol !== ROLES.ADMIN || payload.cookieHash !== cookieHash) return null;
    return payload;
  } catch {
    return null;
  }
}

function authorizationCallbackStatus({ state, cookieValue, adminProof }) {
  const proof = authorizationProof(state, cookieValue, adminProof);
  if (!proof) return "invalid";
  const entry = pendingStates.get(state);
  if (!entry || entry.expiresAt <= Date.now()) {
    pendingStates.delete(state);
    return "expired";
  }
  if (String(proof.id) !== String(entry.userId) ||
    createHash("sha256").update(cookieValue).digest("hex") !== entry.cookieHash) return "invalid";
  return "pending";
}

function consumeAuthorizationError({ state, cookieValue, adminProof, googleError }) {
  const status = authorizationCallbackStatus({ state, cookieValue, adminProof });
  if (status !== "pending") return status;
  pendingStates.delete(state);
  return googleError === "access_denied" ? "cancelled" : "error";
}

// El state de un solo uso se enlaza a una cookie HttpOnly/SameSite del navegador y a PKCE.
function startAuthorization(userId, role) {
  if (role !== ROLES.ADMIN) throw clientError(403, "Solo un administrador puede autorizar Google Drive.");
  const { clientId, redirectUri } = oauthConfiguration();
  if (!tokenStore.encryptionKeyConfigured()) throw configurationError(["GOOGLE_TOKEN_ENCRYPTION_KEY"]);
  if (env("GOOGLE_REFRESH_TOKEN")) refreshToken();
  if ((process.env.GOOGLE_REFRESH_TOKEN_ENC || "").trim()) {
    const error = new Error("La autorización se debe completar en el entorno local y después actualizar GOOGLE_REFRESH_TOKEN_ENC de forma manual.");
    error.status = 503;
    throw error;
  }
  if (!env("JWT_SECRET")) throw configurationError(["JWT_SECRET"]);
  purgeStates();
  const state = randomBytes(32).toString("hex");
  const verifier = randomBytes(48).toString("base64url");
  const cookieValue = randomBytes(32).toString("base64url");
  const cookieHash = createHash("sha256").update(cookieValue).digest("hex");
  const signedAdminProof = jwt.sign(
    { id: userId, rol: role, state, cookieHash },
    process.env.JWT_SECRET,
    { expiresIn: STATE_COOKIE_TTL_MS / 1000, audience: "gdrive-oauth-session" }
  );
  pendingStates.set(state, {
    verifier,
    userId,
    cookieHash,
    expiresAt: Date.now() + STATE_TTL_MS
  });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256"
  });
  return {
    authorizationUrl: `${AUTH_URL}?${params}`,
    cookieName: stateCookieName(state),
    cookieValue,
    adminCookieName: adminCookieName(state),
    adminCookieValue: signedAdminProof,
    expiresInSeconds: STATE_COOKIE_TTL_MS / 1000
  };
}

// Las cookies de OAuth deben fijarse en una navegación de primer nivel hacia el backend: una respuesta
// fetch entre sitios (portal y API en dominios distintos) no puede guardar cookies SameSite=Lax.
// El ticket de un solo uso, aleatorio y de 60 s, enlaza esa navegación con el flujo ya iniciado por el administrador.
function createLaunchTicket(flow) {
  const now = Date.now();
  for (const [ticket, entry] of launchTickets) if (entry.expiresAt <= now) launchTickets.delete(ticket);
  while (launchTickets.size >= MAX_PENDING_STATES) launchTickets.delete(launchTickets.keys().next().value);
  const ticket = randomBytes(32).toString("base64url");
  launchTickets.set(ticket, { flow, expiresAt: now + LAUNCH_TTL_MS });
  return `${new URL(oauthConfiguration().redirectUri).origin}/api/auth/google/autorizar?ticket=${ticket}`;
}

function consumeLaunchTicket(ticket) {
  const entry = typeof ticket === "string" ? launchTickets.get(ticket) : undefined;
  if (typeof ticket === "string") launchTickets.delete(ticket);
  return entry && entry.expiresAt > Date.now() ? entry.flow : null;
}

async function completeAuthorization({ code, state, cookieValue, adminProof }) {
  const entry = typeof state === "string" ? pendingStates.get(state) : undefined;
  if (!entry || entry.expiresAt <= Date.now() || !cookieValue ||
    createHash("sha256").update(cookieValue).digest("hex") !== entry.cookieHash ||
    !validAdminProof(adminProof, state, entry.userId)) {
    throw clientError(400, "La solicitud de autorización no es válida o expiró. Inicia el proceso de nuevo.");
  }
  pendingStates.delete(state);
  if (typeof code !== "string" || !code || code.length > 2048) throw clientError(400, "Falta el código de autorización de Google.");
  const { clientId, clientSecret, redirectUri } = oauthConfiguration();
  const response = await googleFetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri,
      grant_type: "authorization_code", code_verifier: entry.verifier
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!String(data.scope || "").split(" ").includes(SCOPE)) {
    throw clientError(400, "Google no concedió el permiso necesario (drive.file).");
  }
  if (typeof data.refresh_token !== "string" || !data.refresh_token) {
    throw clientError(400, "Google no devolvió un refresh token. Revoca el acceso previo de la aplicación en la cuenta de Google y repite la autorización.");
  }
  try {
    tokenStore.write({ refreshToken: data.refresh_token });
  } catch (error) {
    const failure = new Error(error.code === "TOKEN_STORE_ENV_CONFIGURED"
      ? "No se guardó la autorización. Completa el flujo local y actualiza GOOGLE_REFRESH_TOKEN_ENC de forma manual."
      : "No se pudo guardar la autorización en el almacén local cifrado.");
    failure.status = 503;
    failure.code = error.code;
    throw failure;
  }
  accessCache = null;
}

async function checkFolder(id) {
  try {
    const response = await driveFetch(`${DRIVE_URL}/files/${id}?fields=id,name,mimeType,trashed&supportsAllDrives=false`);
    const data = await response.json();
    const usable = data.mimeType === "application/vnd.google-apps.folder" && !data.trashed;
    return { accessible: usable, name: usable && typeof data.name === "string" ? data.name.slice(0, 100) : undefined };
  } catch (error) {
    // Con drive.file, una carpeta que la aplicación no creó ni abrió con Picker responde 404.
    if (error?.$metadata?.httpStatusCode === 404) return { accessible: false };
    throw error;
  }
}

async function status() {
  let storeError;
  let stored = {};
  try {
    stored = tokenStore.read();
  } catch (error) {
    storeError = error.code === "TOKEN_STORE_CORRUPT" ? "encrypted_token_unreadable" : "token_store_unavailable";
  }
  const result = {
    oauthConfigured: true,
    encryptionKeyConfigured: tokenStore.encryptionKeyConfigured(),
    environmentTokenReadOnly: Boolean(env("GOOGLE_REFRESH_TOKEN_ENC")),
    authorized: Boolean(stored.refreshToken) && !env("GOOGLE_REFRESH_TOKEN"),
    folder: { configured: false, accessible: false },
    ...(env("GOOGLE_REFRESH_TOKEN")
      ? { tokenStoreError: "plaintext_refresh_token_disabled" }
      : storeError ? { tokenStoreError: storeError } : {})
  };
  try {
    oauthConfiguration();
  } catch {
    result.oauthConfigured = false;
    return result;
  }
  const configuredFolderId = env("GOOGLE_DRIVE_FOLDER_ID") || stored.folderId;
  const id = FOLDER_ID_PATTERN.test(configuredFolderId) ? configuredFolderId : "";
  result.folder.configured = Boolean(id);
  if (result.authorized && id) {
    try {
      result.folder = { configured: true, id, ...(await checkFolder(id)) };
    } catch (error) {
      result.folder.error = "No fue posible consultar Google Drive.";
      result.cause = error?.$origin;
    }
  }
  return result;
}

async function createFolder(name) {
  const response = await driveFetch(`${DRIVE_URL}/files?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder" })
  });
  const data = await response.json();
  if (!FOLDER_ID_PATTERN.test(data.id || "")) throw failure(undefined, undefined, "sdk", "InvalidFolderResponse");
  try {
    tokenStore.write({ folderId: data.id });
  } catch {
    return {
      id: data.id,
      name,
      persisted: false,
      configure: "GOOGLE_DRIVE_FOLDER_ID",
      message: "La carpeta se creó; configura GOOGLE_DRIVE_FOLDER_ID para conservarla."
    };
  }
  return { id: data.id, name, persisted: true };
}

function assertValidKey(key) {
  if (typeof key !== "string" || !KEY_PATTERN.test(key)) throw clientError(500, "Clave de almacenamiento no válida.");
}

function assertAllowedType(contentType) {
  const { FILE_TYPES } = require("../utils/academicFileUpload");
  if (!Object.values(FILE_TYPES).some(type => type.mime === contentType)) {
    throw clientError(415, "Tipo de archivo no permitido.");
  }
}

async function readBounded(body, limit) {
  const tooLarge = () => clientError(413, `El archivo excede el máximo permitido de ${Math.round(limit / 1024 / 1024)} MiB para Google Drive.`);
  if (Buffer.isBuffer(body)) {
    if (body.length > limit) throw tooLarge();
    return body;
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of body) {
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += piece.length;
    if (total > limit) {
      body.destroy?.();
      throw tooLarge();
    }
    chunks.push(piece);
  }
  return Buffer.concat(chunks, total);
}

async function closeResponse(response) {
  if (response?.body && !response.bodyUsed) {
    try {
      await response.body.cancel();
    } catch {
      // The response may already have been closed by the fetch implementation.
    }
  }
}

async function findFileIds(key) {
  const parent = folderId();
  const query = `name = '${key}' and '${parent}' in parents and trashed = false`;
  let response;
  try {
    response = await driveFetch(`${DRIVE_URL}/files?${new URLSearchParams({ q: query, fields: "files(id)", pageSize: "10", spaces: "drive" })}`);
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404) {
      throw clientError(503, "Google Drive no puede acceder a la carpeta configurada. Verifica GOOGLE_DRIVE_FOLDER_ID y su autorización.");
    }
    throw error;
  }
  const data = await response.json();
  return (Array.isArray(data.files) ? data.files : []).map(file => file.id).filter(id => FOLDER_ID_PATTERN.test(id || ""));
}

async function uploadObject(key, body, contentType) {
  assertValidKey(key);
  assertAllowedType(contentType);
  ensureConfigured();
  if (activeUploads >= MAX_CONCURRENT_UPLOADS) {
    throw clientError(429, "Google Drive está procesando otra subida. Inténtalo de nuevo en unos segundos.");
  }
  activeUploads += 1;
  let response;
  try {
    const content = await readBounded(body, maxFileBytes());
    const parent = folderId();
    if (!(await checkFolder(parent)).accessible) {
      throw clientError(503, "Google Drive no puede acceder a la carpeta configurada. Verifica GOOGLE_DRIVE_FOLDER_ID y su autorización.");
    }
    const boundary = `portal-${randomBytes(16).toString("hex")}`;
    const metadata = JSON.stringify({ name: key, parents: [parent], mimeType: contentType });
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`),
      content,
      Buffer.from(`\r\n--${boundary}--`)
    ]);
    response = await driveFetch(`${UPLOAD_URL}?uploadType=multipart&fields=id`, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: payload
    });
    const result = await response.json();
    if (!FOLDER_ID_PATTERN.test(result.id || "")) {
      throw failure(undefined, undefined, "sdk", "InvalidUploadResponse");
    }
  } finally {
    await closeResponse(response);
    activeUploads -= 1;
  }
}

async function removeObject(key) {
  assertValidKey(key);
  ensureConfigured();
  for (const id of await findFileIds(key)) {
    let response;
    try {
      response = await driveFetch(`${DRIVE_URL}/files/${id}`, { method: "DELETE" });
    } catch (error) {
      if (error?.$metadata?.httpStatusCode !== 404) throw error;
    } finally {
      await closeResponse(response);
    }
  }
}

// Drive no ofrece URL prefirmadas privadas: se emite una URL del propio backend con un token
// firmado de 60 s (secreto derivado, distinto del JWT de sesión) que descarga el archivo en streaming.
function downloadSecret() {
  const base = process.env.JWT_SECRET;
  if (!base) throw configurationError(["JWT_SECRET"]);
  return createHmac("sha256", base).update("gdrive-download-v1").digest("hex");
}

function createDownloadUrl(key, fileName) {
  assertValidKey(key);
  ensureConfigured();
  let base;
  try {
    base = new URL(env("APP_URL"));
    const local = ["localhost", "127.0.0.1"].includes(base.hostname);
    if (base.protocol !== "https:" && !(local && base.protocol === "http:")) throw new Error("protocolo");
  } catch {
    throw configurationError(["APP_URL"]);
  }
  const token = jwt.sign({ k: key, n: String(fileName || "archivo").slice(0, 200) }, downloadSecret(), {
    expiresIn: DOWNLOAD_SECONDS, audience: "gdrive-download"
  });
  return `${base.origin}/api/archivos-academicos/drive/${token}`;
}

function verifyDownloadToken(token) {
  try {
    const payload = jwt.verify(String(token), downloadSecret(), { audience: "gdrive-download" });
    assertValidKey(payload.k);
    return { key: payload.k, fileName: String(payload.n || "archivo") };
  } catch (error) {
    if (error?.status === 503) throw error;
    throw clientError(401, "El enlace de descarga no es válido o expiró.");
  }
}

async function openDownload(key) {
  assertValidKey(key);
  ensureConfigured();
  const [id] = await findFileIds(key);
  if (!id) throw clientError(404, "Archivo no encontrado.");
  const { response, abort } = await driveFetch(`${DRIVE_URL}/files/${id}?alt=media`, {}, { returnAbort: true });
  return {
    body: response.body,
    contentType: response.headers.get("content-type") || "application/octet-stream",
    contentLength: response.headers.get("content-length"),
    cancel: () => {
      abort();
      return response.body ? response.body.cancel().catch(() => {}) : Promise.resolve();
    }
  };
}

module.exports = {
  CALLBACK_PATH, SCOPE, authorizationCallbackStatus, cancelAuthorization, completeAuthorization,
  consumeAuthorizationError, consumeLaunchTicket, createLaunchTicket, createDownloadUrl, createFolder,
  adminCookieName, ensureConfigured, MAX_CONCURRENT_UPLOADS, openDownload, origin, removeObject, resetAccessTokenCache, startAuthorization, stateCookieName,
  status, uploadObject, verifyDownloadToken
};
