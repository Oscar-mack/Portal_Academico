const { verifyToken, isAdmin, hasRole } = require("../middlewares/authJwt.js");
const ROLES = require("../config/roles.js");

module.exports = app => {
  const vinculos = require("../controllers/padreAlumno.controller.js");
  const router = require("express").Router();

  router.get("/mis-alumnos", [verifyToken, hasRole(ROLES.PADRE)], vinculos.misAlumnos);
  // Enlazar/desenlazar cuentas padre con alumnos: exclusivo del Administrador.
  router.post("/", [verifyToken, isAdmin], vinculos.create);
  router.get("/", [verifyToken, isAdmin], vinculos.findAll);
  router.delete("/:id", [verifyToken, isAdmin], vinculos.delete);

  app.use("/api/padres-alumnos", router);
};
