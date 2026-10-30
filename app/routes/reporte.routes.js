const { verifyToken, isAdmin, isAdminOrCatedratico, isAnyRole, hasRole } = require("../middlewares/authJwt.js");
const ROLES = require("../config/roles.js");

module.exports = app => {
  const reportes = require("../controllers/reporte.controller.js");
  const router = require("express").Router();

  // RF-09 — Reporte de notas por catedrático (Admin o el propio catedrático)
  router.get("/notas-por-catedratico/:catedraticoId", [verifyToken, isAdminOrCatedratico], reportes.notasPorCatedratico);

  // RF-12 — Indicadores académicos (aprobados/reprobados por rango) — Administrador
  router.get("/indicadores", [verifyToken, isAdmin], reportes.indicadores);

  // RF-10 / RF-11 — Boleta en PDF (Admin, Catedrático, el propio Alumno o su Padre/Tutor)
  router.get("/boleta-pdf/:alumnoId", [verifyToken, isAnyRole], reportes.boletaPDF);
  router.get("/estado-cuenta-pdf/:alumnoId", [
    verifyToken,
    hasRole(ROLES.ADMIN, ROLES.ALUMNO, ROLES.PADRE)
  ], reportes.estadoCuentaPDF);

  app.use("/api/reportes", router);
};
