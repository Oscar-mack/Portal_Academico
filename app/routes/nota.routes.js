const { verifyToken, isAdmin, isAdminOrCatedratico, isAnyRole } = require("../middlewares/authJwt.js");

module.exports = app => {
  const notas = require("../controllers/nota.controller.js");
  const router = require("express").Router();

  // RF-07 — Registro de notas: Administrador o Catedrático responsable del curso (RN-05,
  // validado con más detalle dentro del controlador: solo su propio curso).
  router.post("/", [verifyToken, isAdminOrCatedratico], notas.create);

  // RF-08 — Consulta de notas: visibilidad restringida por rol dentro del controlador
  // (alumno solo las suyas, padre solo las de sus hijos, catedrático solo las que registró).
  router.get("/", [verifyToken, isAnyRole], notas.findAll);
  router.get("/:id", [verifyToken, isAnyRole], notas.findOne);
  router.put("/:id", [verifyToken, isAdminOrCatedratico], notas.update);

  // Eliminación reservada al Administrador.
  router.delete("/:id", [verifyToken, isAdmin], notas.delete);

  app.use("/api/notas", router);
};
