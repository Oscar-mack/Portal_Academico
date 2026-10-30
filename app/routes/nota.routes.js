const { verifyToken, isAdmin, isAdminOrCatedratico, isAnyRole } = require("../middlewares/authJwt.js");

module.exports = app => {
  const notas = require("../controllers/nota.controller.js");
  const router = require("express").Router();

  // RF-07 — Registro de notas: Administrador o Catedratico responsable del curso (RN-05).
  router.post("/", [verifyToken, isAdminOrCatedratico], notas.create);

  // RF-08 — Consulta de notas: visibilidad restringida por rol dentro del controlador.
  // B1: alumnos y tutores solo ven notas con publicadaEn != null.
  router.get("/", [verifyToken, isAnyRole], notas.findAll);
  router.get("/:id/historial", [verifyToken, isAnyRole], notas.historial);
  router.get("/:id", [verifyToken, isAnyRole], notas.findOne);
  router.put("/:id", [verifyToken, isAdminOrCatedratico], notas.update);

  // B5: Publicacion explicita de nota — la hace visible a alumno y tutor.
  router.patch("/:id/publicar", [verifyToken, isAdminOrCatedratico], notas.publish);

  // Eliminacion reservada al Administrador.
  router.delete("/:id", [verifyToken, isAdmin], notas.delete);

  app.use("/api/notas", router);
};
