const {
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client
} = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

let client;

function configuration() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    const error = new Error("El almacenamiento académico no está configurado.");
    error.status = 503;
    throw error;
  }
  return {
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    bucket: R2_BUCKET_NAME
  };
}

function getClient() {
  const config = configuration();
  if (!client) {
    client = new S3Client({
      endpoint: config.endpoint,
      region: "auto",
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    });
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

module.exports = { createDownloadUrl, ensureConfigured, removeObject, uploadObject };
