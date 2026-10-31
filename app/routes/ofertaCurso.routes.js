const { verifyToken, isAdmin, hasRole } = require("../middlewares/authJwt.js");
const ROLES = require("../config/roles.js");

module.exports = app => {
  const ofertas = require("../controllers/ofertaCurso.controller.js");
  const router = require("express").Router();

  router.get("/disponibles", [verifyToken, hasRole(ROLES.ALUMNO)], ofertas.disponibles);
  router.get("/", [verifyToken, isAdmin], ofertas.findAll);
  router.post("/", [verifyToken, isAdmin], ofertas.create);
  router.put("/:id", [verifyToken, isAdmin], ofertas.update);

  app.use("/api/ofertas-curso", router);
};
