const { verifyToken, isAdmin } = require("../middlewares/authJwt.js");

module.exports = app => {
  const vinculos = require("../controllers/padreAlumno.controller.js");
  const router = require("express").Router();

  // Enlazar/desenlazar cuentas padre con alumnos: exclusivo del Administrador.
  router.post("/", [verifyToken, isAdmin], vinculos.create);
  router.get("/", [verifyToken, isAdmin], vinculos.findAll);
  router.delete("/:id", [verifyToken, isAdmin], vinculos.delete);

  app.use("/api/padres-alumnos", router);
};
