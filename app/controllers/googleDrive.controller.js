const { Readable } = require("node:stream");
const storage = require("../services/r2Storage.js");
const googleDrive = require("../services/googleDriveStorage.js");

const DEFAULT_FOLDER_NAME = "Portal Academico Documentos (ensayo)";
const DOWNLOAD_IDLE_TIMEOUT_MS = 20000;

// Los fallos de Google se registran con datos no sensibles y se devuelven como el mismo 503 genérico.
function fail(res, error, operation, fallback) {
  const translated = storage.translateFailure(error, operation, googleDrive.origin());
  const status = Number.isInteger(translated.status) ? translated.status : 500;
  res.status(status).send({ message: status === 500 ? fallback : translated.message });
}

function page(res, status, title, message) {
  res.status(status).set("Cache-Control", "no-store").type("html").send(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${title}</title></head>` +
    `<body><h1>${title}</h1><p>${message}</p></body></html>`
  );
}

function redirectToPortal(res, outcome) {
  if (!["authorized", "cancelled", "expired", "error"].includes(outcome)) return false;
  try {
    const frontend = new URL(process.env.FRONTEND_URL);
    const local = ["localhost", "127.0.0.1"].includes(frontend.hostname);
    if ((frontend.protocol !== "https:" && !(local && frontend.protocol === "http:")) ||
      frontend.username || frontend.password || frontend.search || frontend.hash || (frontend.pathname !== "/" && frontend.pathname !== "")) {
      return false;
    }
    res.set("Cache-Control", "no-store").redirect(303, `${frontend.origin}/portal?googleDrive=${outcome}`);
    return true;
  } catch {
    return false;
  }
}

function cookieValue(req, name) {
  const cookies = String(req.headers.cookie || "").split(";");
  const prefix = `${name}=`;
  const value = cookies.map(cookie => cookie.trim()).find(cookie => cookie.startsWith(prefix));
  if (!value) return "";
  try {
    return decodeURIComponent(value.slice(prefix.length));
  } catch {
    return "";
  }
}

function clearStateCookie(res, name, secure) {
  res.append("Set-Cookie", `${name}=; Path=/api/auth/google/callback; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`);
}

function setFlowCookies(res, flow) {
  const secure = new URL(process.env.GOOGLE_REDIRECT_URI).protocol === "https:";
  for (const [name, value] of [[flow.cookieName, flow.cookieValue], [flow.adminCookieName, flow.adminCookieValue]]) {
    res.append(
      "Set-Cookie",
      `${name}=${encodeURIComponent(value)}; Path=/api/auth/google/callback; HttpOnly; SameSite=Lax; Max-Age=${flow.expiresInSeconds}${secure ? "; Secure" : ""}`
    );
  }
}

// Paso 1 (fetch autenticado con Bearer): crea el flujo y devuelve una URL de lanzamiento del backend.
// No fija cookies aquí: una respuesta fetch entre sitios no las conserva con SameSite=Lax.
exports.start = (req, res) => {
  try {
    const flow = googleDrive.startAuthorization(req.userId, req.userRole);
    res.set("Cache-Control", "no-store").send({
      authorizationUrl: googleDrive.createLaunchTicket(flow),
      expiresInSeconds: flow.expiresInSeconds
    });
  } catch (error) {
    fail(res, error, "autorizacion", "No fue posible iniciar la autorización de Google.");
  }
};

// Paso 2 (navegación de primer nivel del navegador): fija las cookies HttpOnly en el dominio del
// backend y redirige a Google. El ticket es de un solo uso.
exports.launch = (req, res) => {
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  const flow = googleDrive.consumeLaunchTicket(req.query.ticket);
  if (!flow) {
    if (redirectToPortal(res, "expired")) return;
    return page(res, 400, "Autorización expirada", "La solicitud expiró. Inicia el proceso de nuevo desde el portal.");
  }
  setFlowCookies(res, flow);
  googleDrive.trace("cookies_emision", "ok", { flow: flow.flowId });
  res.redirect(303, flow.authorizationUrl);
};

exports.callback = async (req, res) => {
  const { code, state, error } = req.query;
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  const flow = googleDrive.flowId(state);
  googleDrive.trace("callback_google", "ok", {
    flow,
    reason: error !== undefined ? "con_error_de_google" : typeof code === "string" && code ? "con_codigo" : "sin_codigo",
    code: typeof error === "string" && /^[a-z_]{1,40}$/.test(error) ? error : undefined
  });
  const cookieName = typeof state === "string" ? googleDrive.stateCookieName(state) : "";
  const adminCookieName = typeof state === "string" ? googleDrive.adminCookieName(state) : "";
  const secure = (() => {
    try { return new URL(process.env.GOOGLE_REDIRECT_URI).protocol === "https:"; } catch { return true; }
  })();
  const value = cookieName ? cookieValue(req, cookieName) : "";
  const adminProof = adminCookieName ? cookieValue(req, adminCookieName) : "";
  if (cookieName) clearStateCookie(res, cookieName, secure);
  if (adminCookieName) clearStateCookie(res, adminCookieName, secure);
  const callbackStatus = googleDrive.authorizationCallbackStatus({ state, cookieValue: value, adminProof });
  if (callbackStatus === "invalid") {
    return page(res, 400, "Autorización no válida", "La solicitud no corresponde a una autorización iniciada en este navegador. Inicia el proceso de nuevo.");
  }
  if (callbackStatus === "expired") {
    if (redirectToPortal(res, "expired")) return;
    return page(res, 400, "Autorización expirada", "La solicitud expiró o el servicio se reinició. Inicia el proceso de nuevo.");
  }
  if (error !== undefined || typeof code !== "string" || !code) {
    const outcome = googleDrive.consumeAuthorizationError({
      state,
      cookieValue: value,
      adminProof,
      googleError: typeof error === "string" ? error : ""
    });
    if (outcome === "cancelled" || outcome === "error") {
      if (redirectToPortal(res, outcome)) return;
      return page(res, 400, outcome === "cancelled" ? "Autorización cancelada" : "Error de autorización",
        outcome === "cancelled"
          ? "Google no concedió el acceso. Puedes iniciar el proceso de nuevo."
          : "No se pudo completar la autorización de Google. Inicia el proceso de nuevo.");
    }
    if (outcome === "expired" && redirectToPortal(res, outcome)) return;
    return page(res, 400, "Autorización no válida", "La solicitud no es válida o expiró. Inicia el proceso de nuevo.");
  }
  try {
    await googleDrive.completeAuthorization({ code, state, cookieValue: value, adminProof });
    googleDrive.trace("retorno_portal", "ok", { flow, reason: "authorized" });
    if (redirectToPortal(res, "authorized")) return;
    page(res, 200, "Google Drive autorizado", "La cuenta quedó autorizada. Puedes cerrar esta ventana.");
  } catch (failure) {
    storage.translateFailure(failure, "autorizacion", googleDrive.origin());
    googleDrive.trace("retorno_portal", "rechazado", { flow, reason: "error" });
    if (redirectToPortal(res, "error")) return;
    page(res, 400, "No se pudo completar la autorización", "Google no pudo completar la autorización. Inicia el proceso de nuevo.");
  }
};

exports.status = async (req, res) => {
  try {
    res.set("Cache-Control", "no-store").send(await googleDrive.status());
  } catch (error) {
    fail(res, error, "estado", "No fue posible consultar el estado de Google Drive.");
  }
};

exports.createFolder = async (req, res) => {
  const name = req.body?.nombre === undefined ? DEFAULT_FOLDER_NAME : req.body.nombre;
  if (typeof name !== "string" || !name.trim() || name.length > 100 || /[\u0000-\u001f]/.test(name)) {
    return res.status(400).send({ message: "nombre debe ser un texto de 1 a 100 caracteres." });
  }
  try {
    res.status(201).send(await googleDrive.createFolder(name.trim()));
  } catch (error) {
    fail(res, error, "carpeta", "No fue posible crear la carpeta en Google Drive.");
  }
};

exports.download = async (req, res) => {
  try {
    const { key, fileName } = googleDrive.verifyDownloadToken(req.params.token);
    const file = await googleDrive.openDownload(key);
    const safeName = fileName.replace(/[\r\n"]/g, "_");
    res.set({
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
      "Cache-Control": "no-store"
    });
    if (file.contentLength) res.set("Content-Length", file.contentLength);
    const stream = Readable.fromWeb(file.body);
    let idleTimer;
    let cancelled = false;
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => stream.destroy(new Error("La descarga de Google Drive quedó inactiva.")), DOWNLOAD_IDLE_TIMEOUT_MS);
    };
    const cancelDownload = () => {
      if (cancelled) return;
      cancelled = true;
      clearTimeout(idleTimer);
      file.cancel().catch(() => {});
      if (!stream.destroyed) stream.destroy();
    };
    stream.on("data", resetIdleTimer);
    stream.once("close", () => clearTimeout(idleTimer));
    resetIdleTimer();
    res.on("close", () => {
      if (!res.writableFinished) cancelDownload();
    });
    stream.on("error", () => {
      cancelDownload();
      res.destroy();
    });
    stream.pipe(res);
  } catch (error) {
    if (res.headersSent) return res.destroy();
    fail(res, error, "descarga", "No fue posible descargar el archivo.");
  }
};
