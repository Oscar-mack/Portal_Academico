const fs = require("node:fs");
const path = require("node:path");
const { createCipheriv, createDecipheriv, createHash, randomBytes } = require("node:crypto");

const DEFAULT_PATH = path.resolve(process.cwd(), ".secrets", "google-drive-token.enc");
const MIN_KEY_LENGTH = 32;
const FORMAT = "v1";

function storePath() {
  const configured = (process.env.GOOGLE_TOKEN_STORE_PATH || "").trim();
  return configured ? path.resolve(configured) : DEFAULT_PATH;
}

function encryptionKey() {
  const secret = (process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || "").trim();
  if (secret.length < MIN_KEY_LENGTH) return null;
  return createHash("sha256").update(secret).digest();
}

function encryptedEnvironmentValue() {
  return (process.env.GOOGLE_REFRESH_TOKEN_ENC || "").trim();
}

function storeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function encrypt(data, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  return [FORMAT, iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
}

function decrypt(payload, key) {
  const [format, iv, tag, encrypted] = payload.trim().split(".");
  if (format !== FORMAT || !iv || !tag || !encrypted) throw new Error("Formato de almacén no válido.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]);
  return JSON.parse(plain.toString("utf8"));
}

function validStoreData(data) {
  return Boolean(data && typeof data === "object" && !Array.isArray(data) &&
    (data.refreshToken === undefined || typeof data.refreshToken === "string") &&
    (data.folderId === undefined || typeof data.folderId === "string"));
}

// El valor cifrado de entorno tiene prioridad; si está dañado no se oculta el error con una copia
// de disco posiblemente antigua. El archivo cifrado se conserva como compatibilidad local.
function read() {
  const key = encryptionKey();
  const environmentValue = encryptedEnvironmentValue();
  if (!key && environmentValue) {
    throw storeError("TOKEN_STORE_KEY_INVALID", "GOOGLE_TOKEN_ENCRYPTION_KEY debe tener al menos 32 caracteres.");
  }
  if (environmentValue) {
    try {
      const data = decrypt(environmentValue, key);
      if (!validStoreData(data)) throw new Error("invalid data");
      return data;
    } catch {
      throw storeError("TOKEN_STORE_CORRUPT", "GOOGLE_REFRESH_TOKEN_ENC no se pudo descifrar.");
    }
  }
  if (!key) return {};

  let payload;
  try {
    payload = fs.readFileSync(storePath(), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw storeError("TOKEN_STORE_READ_FAILED", "No se pudo leer el almacén cifrado de Google Drive.");
  }
  try {
    const data = decrypt(payload, key);
    if (!validStoreData(data)) throw new Error("invalid data");
    return data;
  } catch {
    throw storeError("TOKEN_STORE_CORRUPT", "El almacén cifrado de Google Drive no se pudo descifrar.");
  }
}

function write(patch) {
  if (encryptedEnvironmentValue()) {
    throw storeError(
      "TOKEN_STORE_ENV_CONFIGURED",
      "GOOGLE_REFRESH_TOKEN_ENC es de solo lectura; actualiza el valor cifrado en la configuración del servicio."
    );
  }
  const key = encryptionKey();
  if (!key) {
    throw storeError("TOKEN_STORE_KEY_INVALID", "GOOGLE_TOKEN_ENCRYPTION_KEY debe tener al menos 32 caracteres.");
  }
  const target = storePath();
  const data = { ...read(), ...patch, updatedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(target), 0o700);
  const temporary = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, encrypt(data, key), { mode: 0o600 });
  fs.renameSync(temporary, target);
  fs.chmodSync(target, 0o600);
}

function exportEncryptedEnvironmentValue() {
  const key = encryptionKey();
  if (!key) {
    throw storeError("TOKEN_STORE_KEY_INVALID", "GOOGLE_TOKEN_ENCRYPTION_KEY debe tener al menos 32 caracteres.");
  }
  const data = read();
  if (typeof data.refreshToken !== "string" || !data.refreshToken) {
    throw storeError("TOKEN_STORE_EMPTY", "No hay un refresh token autorizado en el almacén local.");
  }
  return encrypt(data, key);
}

module.exports = {
  MIN_KEY_LENGTH,
  encryptionKeyConfigured: () => Boolean(encryptionKey()),
  exportEncryptedEnvironmentValue,
  read,
  storePath,
  write
};
