const { verifyToken, isAdmin } = require("../middlewares/authJwt.js");
const { checkDuplicateUsernameOrEmail, checkRolValido } = require("../middlewares/verifySignup.js");

module.exports = app => {
  const auth = require("../controllers/auth.controller.js");
  const router = require("express").Router();

  // La creación de cuentas es exclusiva del Administrador; el primer admin se
  // crea con scripts/create-admin.js, fuera de la API.
  router.post("/signup", [verifyToken, isAdmin, checkRolValido, checkDuplicateUsernameOrEmail], auth.signup);
  router.post("/signin", auth.signin);
  router.get("/perfil", [verifyToken], auth.perfil);

  app.use("/api/auth", router);
};

