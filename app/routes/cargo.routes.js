const { verifyToken, isAdmin, hasRole } = require("../middlewares/authJwt.js");
const ROLES = require("../config/roles.js");

module.exports = app => {
  const cargos = require("../controllers/cargo.controller.js");
  const router = require("express").Router();

  router.get("/solvencia", [verifyToken, hasRole(ROLES.ADMIN, ROLES.ALUMNO, ROLES.PADRE)], cargos.solvencia);
  router.get("/", [verifyToken, hasRole(ROLES.ADMIN, ROLES.ALUMNO, ROLES.PADRE)], cargos.findAll);
  router.post("/", [verifyToken, isAdmin], cargos.create);
  router.put("/:id", [verifyToken, isAdmin], cargos.update);
  router.patch("/:id/anular", [verifyToken, isAdmin], cargos.cancel);
  app.use("/api/cargos", router);
};
