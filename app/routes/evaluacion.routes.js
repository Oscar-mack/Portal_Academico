const { verifyToken, isAdminOrCatedratico, hasRole } = require("../middlewares/authJwt.js");
const ROLES = require("../config/roles.js");

module.exports = app => {
  const evaluaciones = require("../controllers/evaluacion.controller.js");
  const router = require("express").Router();

  router.get("/", [verifyToken, hasRole(ROLES.ADMIN, ROLES.CATEDRATICO, ROLES.ALUMNO)], evaluaciones.findAll);
  router.post("/", [verifyToken, isAdminOrCatedratico], evaluaciones.create);
  router.put("/:id", [verifyToken, isAdminOrCatedratico], evaluaciones.update);
  router.delete("/:id", [verifyToken, isAdminOrCatedratico], evaluaciones.delete);
  router.get("/:id/calificaciones", [verifyToken, isAdminOrCatedratico], evaluaciones.getCalificaciones);
  router.post("/:id/calificaciones", [verifyToken, isAdminOrCatedratico], evaluaciones.registrarCalificacion);

  app.use("/api/evaluaciones", router);
};
