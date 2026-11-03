const { verifyToken, isAdmin } = require("../middlewares/authJwt.js");

module.exports = app => {
  const drive = require("../controllers/googleDrive.controller.js");

  // Solo el Administrador inicia la autorización; el callback lo invoca el navegador al volver de
  // Google y se protege con un estado aleatorio de un solo uso (no lleva JWT).
  const oauth = require("express").Router();
  oauth.post("/iniciar", [verifyToken, isAdmin], drive.start);
  oauth.get("/estado", [verifyToken, isAdmin], drive.status);
  oauth.post("/carpeta", [verifyToken, isAdmin], drive.createFolder);
  oauth.get("/callback", drive.callback);
  app.use("/api/auth/google", oauth);

  // Descarga con token firmado de 60 s emitido por createDownloadUrl (STORAGE_PROVIDER=gdrive).
  const files = require("express").Router();
  files.get("/:token", drive.download);
  app.use("/api/archivos-academicos/drive", files);
};
