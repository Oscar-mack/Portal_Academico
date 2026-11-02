const test = require("node:test");
const assert = require("node:assert/strict");
const storage = require("../app/services/r2Storage.js");

const R2 = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"];
const S3 = ["S3_ENDPOINT", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET"];
const ALL = ["STORAGE_PROVIDER", "STORAGE_DEBUG_BODY", ...R2, ...S3];
const SECRET_R2 = "r2-secret-canary-value";
const SECRET_S3 = "s3-secret-canary-value";

const r2Env = () => ({
  R2_ACCOUNT_ID: "acct123",
  R2_ACCESS_KEY_ID: "r2-key-id",
  R2_SECRET_ACCESS_KEY: SECRET_R2,
  R2_BUCKET_NAME: "r2-bucket"
});
const s3Env = () => ({
  S3_ENDPOINT: "https://proyecto.storage.example.test/storage/v1/s3",
  S3_REGION: "us-east-1",
  S3_ACCESS_KEY_ID: "s3-key-id",
  S3_SECRET_ACCESS_KEY: SECRET_S3,
  S3_BUCKET: "portal-ensayo"
});

// Aplica un entorno aislado, captura console.error/log y restaura todo.
async function withEnv(values, fn) {
  const saved = Object.fromEntries(ALL.map(key => [key, process.env[key]]));
  ALL.forEach(key => delete process.env[key]);
  Object.assign(process.env, values);
  const logs = [];
  const originalError = console.error;
  const originalLog = console.log;
  console.error = (...args) => logs.push(args.join(" "));
  console.log = (...args) => logs.push(args.join(" "));
  try {
    return await fn(logs);
  } finally {
    console.error = originalError;
    console.log = originalLog;
    ALL.forEach(key => {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    });
  }
}

function assertNotConfigured(fn) {
  assert.throws(fn, error => {
    assert.equal(error.status, 503);
    assert.match(error.message, /almacenamiento académico no está configurado/);
    return true;
  });
}

test("sin STORAGE_PROVIDER usa R2 y exige sus cuatro variables", async () => {
  await withEnv({}, () => assertNotConfigured(() => storage.ensureConfigured()));
  await withEnv(r2Env(), () => storage.ensureConfigured());
  for (const name of R2) {
    const env = r2Env();
    delete env[name];
    await withEnv(env, () => assertNotConfigured(() => storage.ensureConfigured()));
  }
});

test("STORAGE_PROVIDER vacío, r2 o R2 con espacios equivalen al valor por defecto", async () => {
  for (const value of ["", "   ", "r2", " R2 "]) {
    await withEnv({ ...r2Env(), STORAGE_PROVIDER: value }, () => storage.ensureConfigured());
    await withEnv({ STORAGE_PROVIDER: value }, () => assertNotConfigured(() => storage.ensureConfigured()));
  }
});

test("proveedor inválido devuelve 503 controlado", async () => {
  await withEnv({ ...r2Env(), ...s3Env(), STORAGE_PROVIDER: "gcs" }, () => {
    assert.throws(() => storage.ensureConfigured(), error => {
      assert.equal(error.status, 503);
      assert.match(error.message, /Proveedor de almacenamiento no válido/);
      return true;
    });
  });
});

test("s3 exige las cinco variables S3_*", async () => {
  await withEnv({ ...s3Env(), STORAGE_PROVIDER: "s3" }, () => storage.ensureConfigured());
  for (const name of S3) {
    const env = { ...s3Env(), STORAGE_PROVIDER: "s3" };
    delete env[name];
    await withEnv(env, () => assertNotConfigured(() => storage.ensureConfigured()));
    await withEnv({ ...env, [name]: "   " }, () => assertNotConfigured(() => storage.ensureConfigured()));
  }
});

test("S3_ENDPOINT debe ser una URL https válida", async () => {
  for (const endpoint of ["no-es-url", "http://insecure.example.test/s3", "ftp://x.example.test"]) {
    await withEnv({ ...s3Env(), S3_ENDPOINT: endpoint, STORAGE_PROVIDER: "s3" },
      () => assertNotConfigured(() => storage.ensureConfigured()));
  }
});

test("las credenciales R2 y S3 nunca se mezclan", async () => {
  await withEnv({ ...r2Env(), STORAGE_PROVIDER: "s3" }, () => assertNotConfigured(() => storage.ensureConfigured()));
  await withEnv({ ...s3Env(), STORAGE_PROVIDER: "r2" }, () => assertNotConfigured(() => storage.ensureConfigured()));
  await withEnv(s3Env(), () => assertNotConfigured(() => storage.ensureConfigured()));
  await withEnv({ ...r2Env(), ...s3Env(), STORAGE_PROVIDER: "s3" }, async () => {
    const { client, bucket } = storage.getClient();
    assert.equal(bucket, "portal-ensayo");
    assert.equal((await client.config.credentials()).accessKeyId, "s3-key-id");
  });
  await withEnv({ ...r2Env(), ...s3Env() }, async () => {
    const { client, bucket } = storage.getClient();
    assert.equal(bucket, "r2-bucket");
    assert.equal((await client.config.credentials()).accessKeyId, "r2-key-id");
  });
});

test("el cliente R2 conserva la configuración original", async () => {
  await withEnv(r2Env(), async () => {
    const { client } = storage.getClient();
    assert.equal(await client.config.region(), "auto");
    assert.equal(client.config.forcePathStyle, true);
    assert.equal((await client.config.endpoint()).hostname, "acct123.r2.cloudflarestorage.com");
    assert.equal(await client.config.requestChecksumCalculation(), "WHEN_SUPPORTED");
    assert.equal(await client.config.responseChecksumValidation(), "WHEN_SUPPORTED");
  });
});

test("el cliente S3 usa endpoint, región, path style y WHEN_REQUIRED", async () => {
  await withEnv({ ...s3Env(), STORAGE_PROVIDER: "s3" }, async () => {
    const { client, bucket } = storage.getClient();
    assert.equal(bucket, "portal-ensayo");
    assert.equal(await client.config.region(), "us-east-1");
    assert.equal(client.config.forcePathStyle, true);
    assert.equal((await client.config.endpoint()).hostname, "proyecto.storage.example.test");
    assert.equal(await client.config.requestChecksumCalculation(), "WHEN_REQUIRED");
    assert.equal(await client.config.responseChecksumValidation(), "WHEN_REQUIRED");
  });
});

test("el cliente se reconstruye cuando cambia la configuración", async () => {
  const first = await withEnv({ ...s3Env(), STORAGE_PROVIDER: "s3" }, () => storage.getClient().client);
  const same = await withEnv({ ...s3Env(), STORAGE_PROVIDER: "s3" }, () => storage.getClient().client);
  const other = await withEnv(r2Env(), () => storage.getClient().client);
  assert.equal(first, same);
  assert.notEqual(first, other);
});

test("el cliente S3 se reconstruye si cambia únicamente el secreto", async () => {
  const first = await withEnv({ ...s3Env(), STORAGE_PROVIDER: "s3" }, () => storage.getClient().client);
  const rotatedSecret = "s3-rotated-secret-canary";
  await withEnv({ ...s3Env(), S3_SECRET_ACCESS_KEY: rotatedSecret, STORAGE_PROVIDER: "s3" }, logs => {
    const second = storage.getClient().client;
    assert.notEqual(first, second);
    assert.ok(logs.length);
    assert.equal(logs.join("\n").includes(rotatedSecret), false);
  });
});

test("el cliente R2 se reconstruye si cambia únicamente el secreto", async () => {
  const first = await withEnv(r2Env(), () => storage.getClient().client);
  const rotatedSecret = "r2-rotated-secret-canary";
  await withEnv({ ...r2Env(), R2_SECRET_ACCESS_KEY: rotatedSecret }, logs => {
    const second = storage.getClient().client;
    assert.notEqual(first, second);
    assert.ok(logs.length);
    assert.equal(logs.join("\n").includes(rotatedSecret), false);
  });
});

test("la URL firmada de S3 usa SigV4, la región y dura 60 segundos", async () => {
  await withEnv({ ...s3Env(), STORAGE_PROVIDER: "s3" }, async () => {
    const url = new URL(await storage.createDownloadUrl("submissions/abc", "Informe final.pdf"));
    assert.equal(url.hostname, "proyecto.storage.example.test");
    assert.match(url.pathname, /\/portal-ensayo\/submissions\/abc$/);
    assert.equal(url.searchParams.get("X-Amz-Expires"), "60");
    assert.equal(url.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
    assert.match(url.searchParams.get("X-Amz-Credential"), /\/us-east-1\/s3\/aws4_request$/);
    assert.match(url.searchParams.get("response-content-disposition"), /Informe%20final\.pdf/);
    assert.equal(url.searchParams.has("x-amz-checksum-mode"), false);
  });
});

test("los errores y registros no exponen valores secretos", async () => {
  const cases = [
    { ...s3Env(), STORAGE_PROVIDER: "s3", S3_REGION: "" },
    { ...r2Env(), R2_BUCKET_NAME: "" },
    { ...s3Env(), ...r2Env(), STORAGE_PROVIDER: "otro" },
    { ...s3Env(), STORAGE_PROVIDER: "s3", S3_ENDPOINT: "http://inseguro.example.test" }
  ];
  for (const env of cases) {
    await withEnv(env, logs => {
      let message = "";
      try {
        storage.ensureConfigured();
      } catch (error) {
        message = error.message;
      }
      const output = [message, ...logs].join("\n");
      for (const secret of [SECRET_R2, SECRET_S3, "s3-key-id", "r2-key-id", "inseguro.example.test"]) {
        assert.equal(output.includes(secret), false);
      }
    });
  }
});

test("el diagnóstico indica solo los nombres de variables faltantes", async () => {
  await withEnv({ ...s3Env(), STORAGE_PROVIDER: "s3", S3_BUCKET: "" }, logs => {
    assert.throws(() => storage.ensureConfigured());
    assert.ok(logs.some(line => line.includes("S3_BUCKET")));
  });
});

// --- Endpoint Supabase y errores inesperados del proveedor ---

test("Supabase exige el path /storage/v1/s3 y se normaliza", async () => {
  const base = { ...s3Env(), STORAGE_PROVIDER: "s3" };
  for (const endpoint of [
    "https://ref.storage.supabase.co",
    "https://ref.storage.supabase.co/",
    "https://ref.storage.supabase.co/storage/v1",
    "https://ref.storage.supabase.co/otro/s3",
    "https://user:pass@ref.storage.supabase.co/storage/v1/s3"
  ]) {
    await withEnv({ ...base, S3_ENDPOINT: endpoint }, logs => {
      assertNotConfigured(() => storage.ensureConfigured());
      assert.equal(logs.join("\n").includes("pass"), false);
    });
  }
  for (const endpoint of ["https://ref.storage.supabase.co/storage/v1/s3", "https://ref.storage.supabase.co/storage/v1/s3/"]) {
    await withEnv({ ...base, S3_ENDPOINT: endpoint }, async () => {
      storage.ensureConfigured();
      const { client, host } = storage.getClient();
      assert.equal(host, "ref.storage.supabase.co");
      assert.equal((await client.config.endpoint()).path, "/storage/v1/s3");
    });
  }
});

test("un endpoint S3 que no es de Supabase no exige ese path", async () => {
  await withEnv({ ...s3Env(), STORAGE_PROVIDER: "s3", S3_ENDPOINT: "https://s3.otro.example.test" },
    () => storage.ensureConfigured());
});

const { createServer } = require("node:https");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

function selfSignedCertificate() {
  const dir = mkdtempSync(path.join(tmpdir(), "storage-test-"));
  try {
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost",
      "-keyout", path.join(dir, "k.pem"), "-out", path.join(dir, "c.pem")
    ], { stdio: "ignore" });
    return { key: readFileSync(path.join(dir, "k.pem")), cert: readFileSync(path.join(dir, "c.pem")) };
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const certificate = selfSignedCertificate();

// Servidor HTTPS local que imita las respuestas del proveedor; no hay red externa.
async function withFakeProvider(reply, fn) {
  const requests = [];
  const server = createServer(certificate, (req, res) => {
    req.resume();
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url.split("?")[0] });
      const { status, type, body } = reply(req);
      res.writeHead(status, { "content-type": type });
      res.end(body);
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const env = { ...s3Env(), STORAGE_PROVIDER: "s3", S3_ENDPOINT: `https://127.0.0.1:${server.address().port}` };
  try {
    return await withEnv(env, logs => fn(logs, requests));
  } finally {
    if (previous === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
    await new Promise(resolve => server.close(resolve));
  }
}

const skipTls = certificate ? false : "openssl no está disponible";
const SECRETS = [SECRET_S3, "s3-key-id", "Authorization", "X-Amz-Signature", "Credential="];

async function assertControlled(operation, logs, expected) {
  await assert.rejects(operation, error => {
    assert.equal(error.status, 503);
    assert.match(error.message, /almacenamiento académico no está disponible/);
    assert.equal(/aws-sdk|XML|Deserialization/i.test(error.message), false);
    return true;
  });
  const output = logs.join("\n");
  for (const text of expected) assert.ok(output.includes(text), `falta en el log: ${text}`);
  for (const secret of SECRETS) assert.equal(output.includes(secret), false);
}

test("respuesta JSON inesperada se convierte en 503 y el log solo trae datos seguros", { skip: skipTls }, async () => {
  const body = JSON.stringify({ statusCode: "404", error: "Bucket not found", message: "token-secreto-en-cuerpo" });
  await withFakeProvider(() => ({ status: 404, type: "application/json", body }), async logs => {
    await assertControlled(() => storage.uploadObject("materials/a", Buffer.from("hola"), "text/plain"), logs,
      ["operacion=subida", "proveedor=s3", "host=127.0.0.1:", "status=404", "respuesta=json", "codigo=Bucket not found"]);
    assert.equal(logs.join("\n").includes("token-secreto-en-cuerpo"), false);
  });
});

test("respuesta HTML inesperada se convierte en 503", { skip: skipTls }, async () => {
  await withFakeProvider(() => ({ status: 404, type: "text/html", body: "<!DOCTYPE html><html>nginx</html>" }), async logs => {
    await assertControlled(() => storage.removeObject("materials/a"), logs,
      ["operacion=eliminacion", "status=404", "respuesta=html"]);
  });
});

test("respuesta XML de error S3 conserva su código y se convierte en 503", { skip: skipTls }, async () => {
  const body = '<?xml version="1.0"?><Error><Code>NoSuchBucket</Code><Message>x</Message></Error>';
  await withFakeProvider(() => ({ status: 404, type: "application/xml", body }), async logs => {
    await assertControlled(() => storage.uploadObject("materials/a", Buffer.from("hola"), "text/plain"), logs,
      ["status=404", "codigo=NoSuchBucket"]);
  });
});

test("las credenciales rechazadas (403) no se propagan como 401/403 al cliente", { skip: skipTls }, async () => {
  const body = '<Error><Code>SignatureDoesNotMatch</Code></Error>';
  await withFakeProvider(() => ({ status: 403, type: "application/xml", body }), async logs => {
    await assertControlled(() => storage.removeObject("materials/a"), logs, ["status=403", "codigo=SignatureDoesNotMatch"]);
  });
});

test("subida y eliminación correctas usan path style con el bucket y la clave", { skip: skipTls }, async () => {
  await withFakeProvider(() => ({ status: 200, type: "application/xml", body: "" }), async (logs, requests) => {
    await storage.uploadObject("materials/ok", Buffer.from("hola"), "text/plain");
    await storage.removeObject("materials/ok");
    assert.deepEqual(requests.map(r => `${r.method} ${r.url}`), [
      "PUT /portal-ensayo/materials/ok",
      "DELETE /portal-ensayo/materials/ok"
    ]);
    assert.equal(logs.some(line => line.includes("fallo")), false);
  });
});

test("un error de la aplicación con status propio no se reescribe", async () => {
  const stream = new (require("node:stream").Readable)({
    read() {
      this.destroy(Object.assign(new Error("El contenido no coincide con el formato declarado."), { status: 415 }));
    }
  });
  await withEnv({ ...s3Env(), STORAGE_PROVIDER: "s3" }, async () => {
    await assert.rejects(() => storage.uploadObject("materials/x", stream, "text/plain"), error => error.status === 415);
  });
});

test("la firma de descarga sigue funcionando y no deja rastro en logs", async () => {
  await withEnv({ ...s3Env(), STORAGE_PROVIDER: "s3" }, async logs => {
    const url = await storage.createDownloadUrl("materials/a", "Informe final.pdf");
    assert.match(url, /X-Amz-Algorithm=AWS4-HMAC-SHA256/);
    assert.match(url, /X-Amz-Expires=60/);
    assert.equal(logs.join("\n").includes("X-Amz-Signature"), false);
  });
});

// --- Credenciales S3 y diagnóstico temporal del cuerpo ---

test("las credenciales S3 se recortan y el cliente usa el valor limpio", async () => {
  const env = { ...s3Env(), STORAGE_PROVIDER: "s3", S3_ACCESS_KEY_ID: "  s3-key-id\n", S3_SECRET_ACCESS_KEY: `\t${SECRET_S3} ` };
  await withEnv(env, async () => {
    const { client } = storage.getClient();
    const credentials = await client.config.credentials();
    assert.equal(credentials.accessKeyId, "s3-key-id");
    assert.equal(credentials.secretAccessKey, SECRET_S3);
  });
});

test("las credenciales S3 con espacios o saltos de línea internos se rechazan nombrando solo la variable", async () => {
  for (const [name, value] of [
    ["S3_ACCESS_KEY_ID", "abc def"],
    ["S3_ACCESS_KEY_ID", "abc\ndef"],
    ["S3_SECRET_ACCESS_KEY", "parte-uno parte-dos"],
    ["S3_SECRET_ACCESS_KEY", "parte-uno\r\nparte-dos"]
  ]) {
    await withEnv({ ...s3Env(), STORAGE_PROVIDER: "s3", [name]: value }, logs => {
      assertNotConfigured(() => storage.ensureConfigured());
      const output = logs.join("\n");
      assert.ok(output.includes(name));
      assert.equal(output.includes("abc") || output.includes("parte-uno"), false);
    });
  }
  for (const name of ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) {
    await withEnv({ ...s3Env(), STORAGE_PROVIDER: "s3", [name]: "   " }, () => assertNotConfigured(() => storage.ensureConfigured()));
  }
});

test("las credenciales R2 no se ven afectadas por la normalización de S3", async () => {
  await withEnv({ ...r2Env(), R2_ACCESS_KEY_ID: "r2-key-id" }, async () => {
    const { client } = storage.getClient();
    const credentials = await client.config.credentials();
    assert.equal(credentials.accessKeyId, "r2-key-id");
    assert.equal(credentials.secretAccessKey, SECRET_R2);
  });
});

const BODY_400 = "Invalid request: bucket name is malformed";

test("sin STORAGE_DEBUG_BODY el 400 de texto no registra cuerpo ni longitudes", { skip: skipTls }, async () => {
  await withFakeProvider(() => ({ status: 400, type: "text/plain", body: BODY_400 }), async logs => {
    await assertControlled(() => storage.uploadObject("materials/a", Buffer.from("hola"), "text/plain"), logs,
      ["status=400", "respuesta=texto", "codigo=n/a"]);
    const output = logs.join("\n");
    assert.equal(output.includes("malformed"), false);
    assert.equal(output.includes("cuerpo="), false);
    assert.equal(output.includes("longitud"), false);
  });
});

test("con STORAGE_DEBUG_BODY=true se registra el cuerpo 4xx de texto (máx. 200) y las longitudes", { skip: skipTls }, async () => {
  const long = "x ".repeat(300);
  await withFakeProvider(() => ({ status: 400, type: "text/plain", body: `Bad\nRequest\r\n${long}` }), async logs => {
    process.env.STORAGE_DEBUG_BODY = "true";
    await assertControlled(() => storage.removeObject("materials/a"), logs,
      [`longitudClaveId=${"s3-key-id".length}`, `longitudSecreto=${SECRET_S3.length}`, 'cuerpo="Bad Request x x']);
    const line = logs.find(entry => entry.includes("cuerpo="));
    assert.equal(/[\r\n]/.test(line), false);
    assert.ok(line.match(/cuerpo="([^"]*)"/)[1].length <= 200);
    assert.equal(logs.join("\n").includes(SECRET_S3), false);
  });
});

test("el diagnóstico omite el cuerpo si contiene JWT, firmas, Authorization, URLs, secretos o tokens largos", { skip: skipTls }, async () => {
  const bodies = [
    "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc",
    "Authorization: AWS4-HMAC-SHA256 Credential=x",
    "X-Amz-Signature=abcdef",
    "see https://proyecto.storage.supabase.co/object?token=1",
    `clave ${SECRET_S3} rechazada`,
    "cookie: session=1",
    "id 1234567890abcdefghijklmnopqrstuvwxyz",
    "Bearer abc"
  ];
  for (const body of bodies) {
    await withFakeProvider(() => ({ status: 400, type: "text/plain", body }), async logs => {
      process.env.STORAGE_DEBUG_BODY = "1";
      await assertControlled(() => storage.removeObject("materials/a"), logs, ["cuerpo=omitido"]);
      const output = logs.join("\n");
      for (const fragment of ["eyJ", "AWS4", "Signature", "https://", SECRET_S3, "cookie", "1234567890", "Bearer"]) {
        assert.equal(output.includes(fragment), false, `se filtró: ${fragment}`);
      }
    });
  }
});

test("el diagnóstico no registra cuerpos que no son texto 4xx", { skip: skipTls }, async () => {
  await withFakeProvider(() => ({ status: 404, type: "application/json", body: '{"error":"Bucket not found"}' }), async logs => {
    process.env.STORAGE_DEBUG_BODY = "true";
    await assertControlled(() => storage.removeObject("materials/a"), logs, ["respuesta=json", "longitudClaveId="]);
    assert.equal(logs.join("\n").includes("cuerpo="), false);
  });
  await withFakeProvider(() => ({ status: 500, type: "text/plain", body: "fallo interno" }), async logs => {
    process.env.STORAGE_DEBUG_BODY = "true";
    await assertControlled(() => storage.removeObject("materials/a"), logs, ["status=500"]);
    assert.equal(logs.join("\n").includes("cuerpo="), false);
  });
});

test("los errores propios 413 y 415 siguen sin convertirse en 503 con el diagnóstico activo", async () => {
  for (const status of [413, 415]) {
    const stream = new (require("node:stream").Readable)({
      read() { this.destroy(Object.assign(new Error("error propio"), { status })); }
    });
    await withEnv({ ...s3Env(), STORAGE_PROVIDER: "s3", STORAGE_DEBUG_BODY: "true" }, async () => {
      await assert.rejects(() => storage.uploadObject("materials/x", stream, "text/plain"), error => error.status === status);
    });
  }
});
