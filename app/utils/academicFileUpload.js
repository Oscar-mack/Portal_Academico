const Busboy = require("busboy");
const { createHash } = require("node:crypto");
const { Transform } = require("node:stream");
const storage = require("../services/r2Storage.js");

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const FILE_TYPES = {
  ".pdf": { mime: "application/pdf", signature: "pdf" },
  ".docx": {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    signature: "zip"
  },
  ".xlsx": {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    signature: "zip"
  },
  ".pptx": {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    signature: "zip"
  },
  ".txt": { mime: "text/plain", signature: "text" },
  ".jpg": { mime: "image/jpeg", signature: "jpeg" },
  ".jpeg": { mime: "image/jpeg", signature: "jpeg" },
  ".png": { mime: "image/png", signature: "png" }
};

function validateSignature(buffer, signature) {
  if (signature === "pdf") return buffer.subarray(0, 5).toString() === "%PDF-";
  if (signature === "png") return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (signature === "jpeg") return buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  if (signature === "zip") return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b &&
    [0x03, 0x05, 0x07].includes(buffer[2]) && [0x04, 0x06, 0x08].includes(buffer[3]);
  return signature === "text" && !buffer.includes(0);
}

function contentValidator(signature, hash) {
  let total = 0;
  let prefix = Buffer.alloc(0);
  let checked = false;
  const transform = new Transform({
    transform(chunk, encoding, callback) {
      total += chunk.length;
      if (total > MAX_FILE_BYTES) {
        const error = new Error("El archivo excede el máximo permitido de 20 MiB.");
        error.status = 413;
        callback(error);
        return;
      }
      hash.update(chunk);
      if (!checked) {
        prefix = Buffer.concat([prefix, chunk.subarray(0, 16 - prefix.length)]);
        if (prefix.length >= 16) {
          checked = true;
          if (!validateSignature(prefix, signature)) {
            const error = new Error("El contenido no coincide con el formato declarado.");
            error.status = 415;
            callback(error);
            return;
          }
        }
      }
      callback(null, chunk);
    },
    flush(callback) {
      if (!checked && !validateSignature(prefix, signature)) {
        const error = new Error("El contenido no coincide con el formato declarado.");
        error.status = 415;
        callback(error);
        return;
      }
      callback();
    }
  });
  Object.defineProperty(transform, "sizeBytes", { get: () => total });
  return transform;
}

function safeOriginalName(filename) {
  return String(filename).replaceAll("\\", "/").split("/").pop().slice(0, 255);
}

async function uploadMultipart(req, storageKey) {
  const { uploadObject, removeObject } = storage;
  storage.ensureConfigured();
  return new Promise((resolve, reject) => {
    let parser;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: { files: 1, fields: 4, fieldSize: 2048, fileSize: MAX_FILE_BYTES }
      });
    } catch {
      reject(Object.assign(new Error("Se requiere una carga multipart/form-data válida."), { status: 400 }));
      return;
    }

    const fields = {};
    let foundFile = false;
    let uploadPromise;
    let fileInfo;
    let uploadFileStream;
    let validatorStream;
    let failure = false;
    const fail = async error => {
      if (failure) return;
      failure = true;
      try {
        if (uploadFileStream) {
          uploadFileStream.unpipe(validatorStream);
          uploadFileStream.resume();
        }
        if (validatorStream && !validatorStream.destroyed) {
          validatorStream.destroy(error);
        }
        if (uploadPromise) await uploadPromise.catch(() => {});
        await removeObject(storageKey);
      } catch {
        // The original upload/validation error is the actionable failure.
      }
      reject(error);
    };

    parser.on("field", (name, value) => {
      fields[name] = value;
    });
    parser.on("filesLimit", () => fail(Object.assign(new Error("Solo se permite un archivo por operación."), { status: 400 })));
    parser.on("fieldsLimit", () => fail(Object.assign(new Error("La solicitud contiene demasiados campos."), { status: 400 })));
    parser.on("file", (fieldName, file, info) => {
      if (foundFile || fieldName !== "file") {
        file.resume();
        fail(Object.assign(new Error("Envía exactamente un archivo en el campo file."), { status: 400 }));
        return;
      }
      foundFile = true;
      uploadFileStream = file;
      file.on("error", error => {
        if (!failure) fail(error);
      });
      const originalName = safeOriginalName(info.filename);
      const extension = originalName.slice(originalName.lastIndexOf(".")).toLowerCase();
      const type = FILE_TYPES[extension];
      if (!originalName || !type || type.mime !== info.mimeType) {
        file.resume();
        fail(Object.assign(new Error("Formato de archivo no permitido o MIME incorrecto."), { status: 415 }));
        return;
      }
      const hash = createHash("sha256");
      const validator = contentValidator(type.signature, hash);
      validatorStream = validator;
      validator.on("error", error => {
        if (!failure) fail(error);
      });
      file.on("limit", () => fail(Object.assign(new Error("El archivo excede el máximo permitido de 20 MiB."), { status: 413 })));
      file.pipe(validator);
      uploadPromise = uploadObject(storageKey, validator, type.mime);
      uploadPromise.catch(error => fail(error));
      fileInfo = { originalName, mimeType: type.mime, validator, hash };
    });
    parser.on("error", error => fail(error));
    parser.on("finish", async () => {
      if (failure) return;
      if (!foundFile || !fileInfo) {
        reject(Object.assign(new Error("El archivo es obligatorio."), { status: 400 }));
        return;
      }
      try {
        await uploadPromise;
        resolve({
          fields,
          file: {
            nombreOriginal: fileInfo.originalName,
            mimeType: fileInfo.mimeType,
            sizeBytes: fileInfo.validator.sizeBytes,
            sha256: fileInfo.hash.digest("hex")
          }
        });
      } catch (error) {
        await fail(error);
      }
    });
    req.pipe(parser);
  });
}

module.exports = { FILE_TYPES, MAX_FILE_BYTES, uploadMultipart };
