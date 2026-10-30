const { verifyToken, isAdmin, isAnyRole } = require("../middlewares/authJwt.js");

module.exports = app => {
  const ciclos = require("../controllers/cicloAcademico.controller.js");
  const router = require("express").Router();

  router.get("/", [verifyToken, isAnyRole], ciclos.findAll);
  router.post("/", [verifyToken, isAdmin], ciclos.create);
  router.put("/:id", [verifyToken, isAdmin], ciclos.update);
  app.use("/api/ciclos", router);
};
