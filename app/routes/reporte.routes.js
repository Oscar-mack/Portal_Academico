const { verifyToken, isAdmin, isAdminOrCatedratico, isAnyRole } = require("../middlewares/authJwt.js");

module.exports = app => {
  const reportes = require("../controllers/reporte.controller.js");
  const router = require("express").Router();

  // RF-09 — Reporte de notas por catedrático (Admin o el propio catedrático)
  router.get("/notas-por-catedratico/:catedraticoId", [verifyToken, isAdminOrCatedratico], reportes.notasPorCatedratico);

  // RF-12 — Indicadores académicos (aprobados/reprobados por rango) — Administrador
  router.get("/indicadores", [verifyToken, isAdmin], reportes.indicadores);

  // RF-10 / RF-11 — Boleta en PDF (Admin, Catedrático, el propio Alumno o su Padre/Tutor)
  router.get("/boleta-pdf/:alumnoId", [verifyToken, isAnyRole], reportes.boletaPDF);

  app.use("/api/reportes", router);
};

