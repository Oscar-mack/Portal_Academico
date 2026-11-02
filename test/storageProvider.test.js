const test = require("node:test");
const assert = require("node:assert/strict");
const storage = require("../app/services/r2Storage.js");

const R2 = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"];
const S3 = ["S3_ENDPOINT", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET"];
const ALL = ["STORAGE_PROVIDER", ...R2, ...S3];
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
