const { verifyToken, isAdmin, isAnyRole } = require("../middlewares/authJwt.js");

module.exports = app => {
  const catedraticos = require("../controllers/catedratico.controller.js");
  const router = require("express").Router();

  // RF-01 — CRUD de catedráticos: gestión exclusiva del Administrador
  router.post("/", [verifyToken, isAdmin], catedraticos.create);
  router.get("/", [verifyToken, isAnyRole], catedraticos.findAll);
  router.get("/:id", [verifyToken, isAnyRole], catedraticos.findOne);
  router.put("/:id", [verifyToken, isAdmin], catedraticos.update);
  router.delete("/:id", [verifyToken, isAdmin], catedraticos.delete);

  app.use("/api/catedraticos", router);
};

