const { verifyToken, isAdmin, isAnyRole } = require("../middlewares/authJwt.js");

module.exports = app => {
  const requisitos = require("../controllers/requisitoSolvencia.controller.js");
  const router = require("express").Router();

  router.get("/", [verifyToken, isAnyRole], requisitos.findAll);
  router.post("/", [verifyToken, isAdmin], requisitos.create);
  router.put("/:id", [verifyToken, isAdmin], requisitos.update);
  app.use("/api/requisitos-solvencia", router);
};
