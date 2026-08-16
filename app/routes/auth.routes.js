const { verifyToken, isAdmin } = require("../middlewares/authJwt.js");
const { checkDuplicateUsernameOrEmail, checkRolValido } = require("../middlewares/verifySignup.js");

module.exports = app => {
  const auth = require("../controllers/auth.controller.js");
  const router = require("express").Router();

  // La creación de cuentas y la vinculación con perfiles académicos es una acción administrativa.
  router.post("/signup", [checkRolValido, checkDuplicateUsernameOrEmail], auth.signup);
  router.post("/signin", auth.signin);
  router.get("/perfil", [verifyToken], auth.perfil);

  app.use("/api/auth", router);
};

