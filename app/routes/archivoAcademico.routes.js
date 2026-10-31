const { verifyToken, hasRole } = require("../middlewares/authJwt.js");
const ROLES = require("../config/roles.js");

module.exports = app => {
  const archivos = require("../controllers/archivoAcademico.controller.js");
  const router = require("express").Router();
  router.get("/:id/descarga", [
    verifyToken,
    hasRole(ROLES.ADMIN, ROLES.CATEDRATICO, ROLES.ALUMNO)
  ], archivos.download);
  app.use("/api/archivos-academicos", router);
};
