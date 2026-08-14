const { verifyToken, isAdmin, isAnyRole } = require("../middlewares/authJwt.js");

module.exports = app => {
  const grados = require("../controllers/gradoCarrera.controller.js");
  const router = require("express").Router();

  // RF-04 — Gestión de grados/carreras: administración exclusiva del Administrador
  router.post("/", [verifyToken, isAdmin], grados.create);
  router.get("/", [verifyToken, isAnyRole], grados.findAll);
  router.get("/:id", [verifyToken, isAnyRole], grados.findOne);
  router.put("/:id", [verifyToken, isAdmin], grados.update);
  router.delete("/:id", [verifyToken, isAdmin], grados.delete);

  app.use("/api/grados-carreras", router);
};

