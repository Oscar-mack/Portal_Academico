const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const storage = require("../app/services/r2Storage.js");

const NAMES = ["STORAGE_PROVIDER", "STORAGE_DEBUG_BODY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_BUCKET",
  "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"];
const URL_BASE = "https://proyecto.supabase.co";
const ID = "123e4567-e89b-12d3-a456-426614174000";
let counter = 0;
// Cada prueba usa una clave distinta para forzar un cliente nuevo con el fetch simulado.
const secretKey = () => `service-role-canary-${++counter}-${"x".repeat(20)}`;

async function withSupabase(handler, fn, extra = {}) {
  const saved = Object.fromEntries(NAMES.map(n => [n, process.env[n]]));
  NAMES.forEach(n => delete process.env[n]);
  const key = secretKey();
  Object.assign(process.env, {
    STORAGE_PROVIDER: "supabase", SUPABASE_URL: URL_BASE, SUPABASE_SERVICE_ROLE_KEY: key,
    SUPABASE_BUCKET: "portal-ensayo", ...extra
  });
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const request = new Request(input, init);
    const body = Buffer.from(await request.arrayBuffer());
    calls.push({ method: request.method, url: request.url, headers: Object.fromEntries(request.headers), body });
    return handler(calls.at(-1));
  };
  const logs = [];
  const { error, log } = console;
  console.error = (...a) => logs.push(a.join(" "));
  console.log = (...a) => logs.push(a.join(" "));
  try {
    return await fn({ calls, logs, key });
  } finally {
    globalThis.fetch = realFetch;
    console.error = error;
    console.log = log;
    NAMES.forEach(n => (saved[n] === undefined ? delete process.env[n] : (process.env[n] = saved[n])));
  }
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const text = (status, body) => new Response(body, { status, headers: { "content-type": "text/plain" } });
const ok = () => json(200, { Key: "portal-ensayo/x", signedURL: `/object/sign/portal-ensayo/materials/${ID}?token=SIGNEDTOKEN`, message: "ok" });

test("subida: envía el archivo al bucket privado con la ruta y el tipo indicados", async () => {
  await withSupabase(ok, async ({ calls, key }) => {
    await storage.uploadObject(`materials/${ID}`, Readable.from([Buffer.from("hola "), Buffer.from("mundo")]), "application/pdf");
    const [call] = calls;
    assert.equal(call.method, "POST");
    assert.equal(call.url, `${URL_BASE}/storage/v1/object/portal-ensayo/materials/${ID}`);
    assert.equal(call.headers["x-upsert"], "false");
    assert.equal(call.headers.authorization, `Bearer ${key}`);
    assert.match(call.body.toString("latin1"), /hola mundo/);
    assert.equal(call.headers["content-type"], "application/pdf");
  });
});

test("subida: acepta tasks/ y submissions/ y rechaza rutas inválidas sin llamar a la red", async () => {
  await withSupabase(ok, async ({ calls }) => {
    await storage.uploadObject(`tasks/${ID}`, Readable.from([Buffer.from("a")]), "text/plain");
    await storage.uploadObject(`submissions/${ID}`, Readable.from([Buffer.from("a")]), "text/plain");
    assert.equal(calls.length, 2);
    for (const bad of ["../materials/" + ID, `other/${ID}`, `materials/${ID}/x`, "materials/no-uuid", "", undefined]) {
      await assert.rejects(storage.uploadObject(bad, Readable.from([Buffer.from("a")]), "text/plain"), e => e.status === 500);
      await assert.rejects(storage.removeObject(bad), e => e.status === 500);
      await assert.rejects(storage.createDownloadUrl(bad, "a.pdf"), e => e.status === 500);
    }
    assert.equal(calls.length, 2);
  });
});

test("subida: un archivo de más de 20 MiB se rechaza con 413 antes de enviarlo", async () => {
  await withSupabase(ok, async ({ calls }) => {
    const big = Readable.from([Buffer.alloc(12 * 1024 * 1024), Buffer.alloc(12 * 1024 * 1024)]);
    await assert.rejects(storage.uploadObject(`materials/${ID}`, big, "application/pdf"), e => e.status === 413);
    assert.equal(calls.length, 0);
  });
});

test("subida: un error del flujo de origen conserva su status propio", async () => {
  await withSupabase(ok, async () => {
    const failing = new Readable({ read() { const e = new Error("tipo no permitido"); e.status = 415; this.destroy(e); } });
    await assert.rejects(storage.uploadObject(`materials/${ID}`, failing, "text/plain"), e => e.status === 415);
  });
});

test("eliminación: llama a la API de borrado con la ruta", async () => {
  await withSupabase(() => json(200, []), async ({ calls }) => {
    await storage.removeObject(`submissions/${ID}`);
    assert.equal(calls[0].method, "DELETE");
    assert.equal(calls[0].url, `${URL_BASE}/storage/v1/object/portal-ensayo`);
    assert.deepEqual(JSON.parse(calls[0].body.toString()), { prefixes: [`submissions/${ID}`] });
  });
});

test("URL firmada: 60 segundos, bucket privado y nombre de descarga codificado una sola vez", async () => {
  await withSupabase(ok, async ({ calls }) => {
    const url = await storage.createDownloadUrl(`materials/${ID}`, 'Informe "final" ñ.pdf');
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].url, `${URL_BASE}/storage/v1/object/sign/portal-ensayo/materials/${ID}`);
    assert.equal(JSON.parse(calls[0].body.toString()).expiresIn, 60);
    assert.ok(url.startsWith(`${URL_BASE}/storage/v1/object/sign/`));
    assert.equal(new URL(url).searchParams.get("download"), 'Informe _final_ ñ.pdf');
    assert.ok(!url.includes("/public/"));
  });
});

test("errores del SDK: 400/500 de texto, 403 y fallos de red se convierten en 503 controlado", async () => {
  const cases = [text(400, "Project not specified."), json(403, { statusCode: "403", error: "Unauthorized", message: "bad" }), text(500, "boom")];
  for (const response of cases) {
    await withSupabase(() => response.clone(), async ({ logs, key }) => {
      for (const op of [
        () => storage.uploadObject(`materials/${ID}`, Readable.from([Buffer.from("a")]), "text/plain"),
        () => storage.removeObject(`materials/${ID}`),
        () => storage.createDownloadUrl(`materials/${ID}`, "a.pdf")
      ]) {
        await assert.rejects(op(), e => e.status === 503 && /no está disponible o devolvió una respuesta inesperada/.test(e.message));
      }
      assert.ok(logs.some(l => /proveedor=supabase host=proyecto\.supabase\.co status=\d{3}/.test(l)));
      assert.ok(!logs.join("\n").includes(key));
    });
  }
  await withSupabase(() => { throw new TypeError("fetch failed"); }, async () => {
    await assert.rejects(storage.removeObject(`materials/${ID}`), e => e.status === 503);
  });
});

test("el cuerpo del error solo se registra con STORAGE_DEBUG_BODY y filtrado", async () => {
  const projectError = () => json(400, { message: "Project not specified." });
  await withSupabase(projectError, async ({ logs }) => {
    await assert.rejects(storage.removeObject(`materials/${ID}`));
    assert.ok(!logs.join("\n").includes("Project not specified"));
  });
  await withSupabase(projectError, async ({ logs }) => {
    await assert.rejects(storage.removeObject(`materials/${ID}`));
    assert.match(logs.join("\n"), /cuerpo="Project not specified\."/);
  }, { STORAGE_DEBUG_BODY: "true" });
  await withSupabase(() => json(400, { message: "Bearer abc https://x.test/?token=1" }), async ({ logs }) => {
    await assert.rejects(storage.removeObject(`materials/${ID}`));
    assert.match(logs.join("\n"), /cuerpo=omitido/);
    assert.ok(!logs.join("\n").includes("abc"));
  }, { STORAGE_DEBUG_BODY: "1" });
});

test("variables faltantes o inválidas: 503 con solo los nombres", async () => {
  const names = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_BUCKET"];
  for (const name of names) {
    await withSupabase(ok, async ({ logs, key }) => {
      delete process.env[name];
      assert.throws(() => storage.ensureConfigured(), e => e.status === 503 && /no está configurado/.test(e.message));
      assert.match(logs.join("\n"), new RegExp(name));
      assert.ok(!logs.join("\n").includes(key));
    });
  }
  const bad = [["SUPABASE_URL", "http://proyecto.supabase.co"], ["SUPABASE_URL", "no-es-url"], ["SUPABASE_SERVICE_ROLE_KEY", "con espacio"],
    ["SUPABASE_BUCKET", "../otro"], ["SUPABASE_BUCKET", "a b"]];
  for (const [name, value] of bad) {
    await withSupabase(ok, async ({ logs }) => {
      process.env[name] = value;
      assert.throws(() => storage.ensureConfigured(), e => e.status === 503);
      assert.match(logs.join("\n"), new RegExp(name));
      assert.ok(!logs.join("\n").includes(value));
    });
  }
  await withSupabase(ok, async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = `  ${process.env.SUPABASE_SERVICE_ROLE_KEY}\n`;
    storage.ensureConfigured();
  });
});

test("las subidas simultáneas están limitadas a 4", async () => {
  let active = 0;
  let peak = 0;
  await withSupabase(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise(r => setTimeout(r, 15));
    active -= 1;
    return ok();
  }, async ({ calls }) => {
    await Promise.all(Array.from({ length: 10 }, () =>
      storage.uploadObject(`materials/${ID}`, Readable.from([Buffer.from("a")]), "text/plain")));
    assert.equal(calls.length, 10);
    assert.ok(peak <= 4, `pico ${peak}`);
  });
});

test("proveedor supabase no usa credenciales R2/S3 y R2 por defecto sigue exigiendo sus variables", async () => {
  await withSupabase(ok, async () => {
    process.env.R2_ACCOUNT_ID = "x";
    storage.ensureConfigured();
    process.env.STORAGE_PROVIDER = "r2";
    assert.throws(() => storage.ensureConfigured(), e => e.status === 503);
    delete process.env.STORAGE_PROVIDER;
    assert.throws(() => storage.ensureConfigured(), e => e.status === 503);
    process.env.STORAGE_PROVIDER = "otro";
    assert.throws(() => storage.ensureConfigured(), e => /r2, s3 o supabase/.test(String(e.message)) || e.status === 503);
  });
});

test("cuerpo de texto plano: se conserva solo con STORAGE_DEBUG_BODY y no llega al usuario", async () => {
  await withSupabase(() => text(400, "Project not specified."), async ({ logs }) => {
    await assert.rejects(storage.removeObject(`materials/${ID}`), e => e.status === 503 && !/Project/.test(e.message));
    assert.match(logs.join("\n"), /status=400 respuesta=texto/);
    assert.match(logs.join("\n"), /cuerpo="Project not specified\."/);
  }, { STORAGE_DEBUG_BODY: "true" });
  await withSupabase(() => text(400, "Project not specified."), async ({ logs }) => {
    await assert.rejects(storage.uploadObject(`materials/${ID}`, Readable.from([Buffer.from("a")]), "text/plain"));
    assert.ok(!logs.join("\n").includes("Project not specified"));
  });
});

test("cuerpo de texto: se lee como máximo 400 caracteres y se registran 200", async () => {
  const long = "palabra ".repeat(500);
  await withSupabase(() => text(400, long), async ({ logs }) => {
    await assert.rejects(storage.removeObject(`materials/${ID}`));
    const body = logs.join("\n").match(/cuerpo="([^"]*)"/)[1];
    assert.ok(body.length <= 200 && body.length > 100);
  }, { STORAGE_DEBUG_BODY: "1" });
});

test("el SDK sigue recibiendo la respuesta original sin consumir y los errores JSON no cambian", async () => {
  let original;
  await withSupabase(() => (original = text(400, "Project not specified.")), async () => {
    await assert.rejects(storage.removeObject(`materials/${ID}`));
    assert.equal(original.bodyUsed, true); // el SDK intentó leerla él mismo (json())
  });
  await withSupabase(() => json(400, { statusCode: "400", error: "Bad", message: "Invalid thing" }), async ({ logs }) => {
    await assert.rejects(storage.removeObject(`materials/${ID}`));
    assert.match(logs.join("\n"), /cuerpo="Invalid thing"/);
  }, { STORAGE_DEBUG_BODY: "true" });
});

test("las respuestas correctas no se leen ni se clonan", async () => {
  let clones = 0;
  await withSupabase(() => {
    const response = ok();
    const clone = response.clone.bind(response);
    response.clone = () => { clones += 1; return clone(); };
    return response;
  }, async () => {
    await storage.createDownloadUrl(`materials/${ID}`, "a.pdf");
    assert.equal(clones, 0);
  });
});

test("un cuerpo de error con la clave, JWT o Authorization no aparece en los logs", async () => {
  await withSupabase(({ headers }) => text(400, `rechazado ${headers.authorization}`), async ({ logs, key }) => {
    await assert.rejects(storage.removeObject(`materials/${ID}`));
    const all = logs.join("\n");
    assert.ok(!all.includes(key));
    assert.ok(!/Bearer/i.test(all.replace(/cuerpo=omitido/, "")));
    assert.match(all, /cuerpo=omitido/);
  }, { STORAGE_DEBUG_BODY: "true" });
  await withSupabase(() => text(400, "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.abc"), async ({ logs }) => {
    await assert.rejects(storage.removeObject(`materials/${ID}`));
    assert.ok(!logs.join("\n").includes("eyJ"));
  }, { STORAGE_DEBUG_BODY: "true" });
});

function netError(code, name = "Error") {
  const root = Object.assign(new Error(`connect ${code} 10.0.0.1:443 https://x.supabase.co/?token=SECRETO`), { code, name });
  return Object.assign(new TypeError("fetch failed"), { cause: root });
}

test("diagnóstico: errores de red sin respuesta HTTP registran origen=red y el código anidado", async () => {
  const codes = ["ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT"];
  for (const code of codes) {
    await withSupabase(() => { throw netError(code); }, async ({ logs, key }) => {
      for (const op of [() => storage.removeObject(`materials/${ID}`),
        () => storage.uploadObject(`materials/${ID}`, Readable.from([Buffer.from("a")]), "text/plain"),
        () => storage.createDownloadUrl(`materials/${ID}`, "a.pdf")]) {
        await assert.rejects(op(), e => e.status === 503 && /no está disponible o devolvió/.test(e.message));
      }
      const failures = logs.filter(l => l.includes("fallo operacion="));
      assert.equal(failures.length, 3);
      for (const line of failures) {
        assert.match(line, new RegExp(`status=n/a respuesta=ninguna codigo=${code} origen=red error=TypeError`));
      }
      const all = logs.join("\n");
      for (const leak of [key, "SECRETO", "10.0.0.1", "https://", "token=", "Bearer"]) assert.ok(!all.includes(leak), leak);
    }, { STORAGE_DEBUG_BODY: "true" });
  }
});

test("diagnóstico: AbortError/TimeoutError y fetch failed sin código se marcan como red", async () => {
  for (const thrown of [Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
    Object.assign(new Error("timeout"), { name: "TimeoutError" }), new TypeError("fetch failed")]) {
    await withSupabase(() => { throw thrown; }, async ({ logs }) => {
      await assert.rejects(storage.removeObject(`materials/${ID}`), e => e.status === 503);
      assert.match(logs.join("\n"), /status=n\/a respuesta=ninguna codigo=(n\/a|[A-Za-z]+) origen=red error=(TypeError|AbortError|TimeoutError)/);
    });
  }
});

test("diagnóstico: un error interno del SDK se marca como origen=sdk y no registra su mensaje", async () => {
  await withSupabase(() => { throw new RangeError("fallo interno con SECRETO https://x.test"); }, async ({ logs, key }) => {
    await assert.rejects(storage.removeObject(`materials/${ID}`), e => e.status === 503);
    const all = logs.join("\n");
    assert.match(all, /status=n\/a respuesta=ninguna codigo=n\/a origen=sdk error=RangeError/);
    assert.ok(!all.includes("SECRETO") && !all.includes(key) && !all.includes("https://x.test"));
  }, { STORAGE_DEBUG_BODY: "true" });
});

test("diagnóstico: una respuesta HTTP recibida se registra como origen=http con su status", async () => {
  await withSupabase(() => text(400, "Project not specified."), async ({ logs }) => {
    await assert.rejects(storage.removeObject(`materials/${ID}`));
    assert.match(logs.join("\n"), /status=400 respuesta=texto codigo=400 origen=http/);
  });
  await withSupabase(() => json(403, { statusCode: "403", error: "Unauthorized", message: "x" }), async ({ logs }) => {
    await assert.rejects(storage.removeObject(`materials/${ID}`));
    assert.match(logs.join("\n"), /status=403 respuesta=texto codigo=403 origen=http/);
  });
});
