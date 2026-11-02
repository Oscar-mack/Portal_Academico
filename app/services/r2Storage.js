const {
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client
} = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

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

function selectedProvider() {
  const raw = (process.env.STORAGE_PROVIDER || "").trim().toLowerCase();
  if (!raw) return "r2";
  if (raw === "r2" || raw === "s3") return raw;
  throw storageError("Proveedor de almacenamiento no válido.", "STORAGE_PROVIDER no es válido (use r2 o s3).");
}

function r2Configuration() {
  const names = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"];
  const missing = names.filter(name => !process.env[name]);
  if (missing.length) throw notConfigured(missing);
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = process.env;
  return {
    provider: "r2",
    bucket: R2_BUCKET_NAME,
    signature: ["r2", R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_BUCKET_NAME].join("|"),
    clientOptions: {
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      region: "auto",
      forcePathStyle: true,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY }
    }
  };
}

function s3Configuration() {
  const names = ["S3_ENDPOINT", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET"];
  const missing = names.filter(name => !(process.env[name] || "").trim());
  if (missing.length) throw notConfigured(missing);
  const endpoint = process.env.S3_ENDPOINT.trim();
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw notConfigured(["S3_ENDPOINT"]);
  }
  if (parsed.protocol !== "https:") throw notConfigured(["S3_ENDPOINT"]);
  const { S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET } = process.env;
  return {
    provider: "s3",
    bucket: S3_BUCKET.trim(),
    host: parsed.host,
    signature: ["s3", endpoint, S3_REGION.trim(), S3_ACCESS_KEY_ID, S3_BUCKET.trim()].join("|"),
    clientOptions: {
      endpoint,
      region: S3_REGION.trim(),
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY }
    }
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
  return { client, bucket: config.bucket };
}

function ensureConfigured() {
  configuration();
}

async function uploadObject(key, body, contentType) {
  const { client: s3, bucket } = getClient();
  await new Upload({
    client: s3,
    params: { Bucket: bucket, Key: key, Body: body, ContentType: contentType },
    queueSize: 1,
    partSize: 5 * 1024 * 1024,
    leavePartsOnError: false
  }).done();
}

async function removeObject(key) {
  const { client: s3, bucket } = getClient();
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

async function createDownloadUrl(key, fileName) {
  const { client: s3, bucket } = getClient();
  const safeFileName = fileName.replace(/[\r\n"]/g, "_");
  const disposition = `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(safeFileName)}`;
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: disposition
    }),
    { expiresIn: 60 }
  );
}

module.exports = { createDownloadUrl, ensureConfigured, getClient, removeObject, uploadObject };
