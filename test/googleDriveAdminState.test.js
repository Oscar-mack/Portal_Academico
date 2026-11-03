const test = require("node:test");
const assert = require("node:assert/strict");

test("una carpeta persistida se presenta como creada mientras se comprueba su acceso", async () => {
  const { describeFolderCreation } = await import("../frontend/src/pages/admin/googleDriveAdminState.mjs");
  const result = describeFolderCreation({
    id: "carpetaPersistida123",
    persisted: true,
    name: "Ensayo"
  });

  assert.equal(result.persisted, true);
  assert.equal(result.id, "carpetaPersistida123");
  assert.match(result.message, /comprobando que esté accesible/i);
  assert.doesNotMatch(result.message, /lista para utilizarse|configurada y accesible/);
});

test("una carpeta no persistida exige GOOGLE_DRIVE_FOLDER_ID y conserva el identificador", async () => {
  const { describeFolderCreation } = await import("../frontend/src/pages/admin/googleDriveAdminState.mjs");
  const result = describeFolderCreation({
    id: "carpetaSoloEnDrive123",
    persisted: false,
    configure: "GOOGLE_DRIVE_FOLDER_ID"
  });

  assert.equal(result.persisted, false);
  assert.equal(result.id, "carpetaSoloEnDrive123");
  assert.match(result.message, /GOOGLE_DRIVE_FOLDER_ID en Render/);
  assert.doesNotMatch(result.message, /quedó seleccionada|lista para utilizarse/);
});

test("los estados de callback muestran mensajes seguros sin confiar en valores desconocidos", async () => {
  const { callbackMessage } = await import("../frontend/src/pages/admin/googleDriveAdminState.mjs");
  assert.match(callbackMessage("cancelled"), /cancelada/);
  assert.match(callbackMessage("expired"), /expiró/);
  assert.match(callbackMessage("error"), /no pudo completar/);
  assert.match(callbackMessage("authorized"), /Comprobando la autorización con el backend/);
  assert.match(callbackMessage("manipulado"), /no es válido/);

  const messages = ["cancelled", "expired", "error", "authorized", "manipulado"]
    .map(callbackMessage)
    .join(" ");
  assert.doesNotMatch(messages, /codigo-sensible|refresh-token|client.secret|access token/i);
});

test("una respuesta de carpeta incompleta no se interpreta como éxito", async () => {
  const { describeFolderCreation } = await import("../frontend/src/pages/admin/googleDriveAdminState.mjs");
  assert.throws(() => describeFolderCreation({ id: "short", persisted: true }));
  assert.throws(() => describeFolderCreation({ id: "carpetaSinEstado123", name: "Ensayo" }));
});
