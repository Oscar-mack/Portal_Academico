const { verifyToken, isAdmin, isAnyRole } = require("../middlewares/authJwt.js");

module.exports = app => {
  const periodos = require("../controllers/periodoAcademico.controller.js");
  const router = require("express").Router();

  router.get("/", [verifyToken, isAnyRole], periodos.findAll);
  router.post("/", [verifyToken, isAdmin], periodos.create);
  router.put("/:id", [verifyToken, isAdmin], periodos.update);
  app.use("/api/periodos", router);
};
