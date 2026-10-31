const { verifyToken, hasRole } = require("../middlewares/authJwt.js");
const ROLES = require("../config/roles.js");

module.exports = app => {
  const materiales = require("../controllers/materialCurso.controller.js");
  const router = require("express").Router();
  router.get("/", [verifyToken, hasRole(ROLES.ADMIN, ROLES.CATEDRATICO, ROLES.ALUMNO)], materiales.findAll);
  router.post("/cursos/:cursoId", [verifyToken, hasRole(ROLES.CATEDRATICO)], materiales.create);
  router.delete("/:id", [verifyToken, hasRole(ROLES.CATEDRATICO)], materiales.deactivate);
  app.use("/api/materiales", router);
};
