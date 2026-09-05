const { verifyToken, isAdmin } = require("../middlewares/authJwt.js");

module.exports = app => {
  const usuarios = require("../controllers/usuario.controller.js");
  const router = require("express").Router();

  // Gestión de cuentas del sistema: exclusiva del Administrador.
  router.get("/", [verifyToken, isAdmin], usuarios.findAll);
  router.get("/:id", [verifyToken, isAdmin], usuarios.findOne);
  router.put("/:id", [verifyToken, isAdmin], usuarios.update);
  router.delete("/:id", [verifyToken, isAdmin], usuarios.delete);

  app.use("/api/usuarios", router);
};
