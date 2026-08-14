const { verifyToken, isAdmin, isAnyRole } = require("../middlewares/authJwt.js");

module.exports = app => {
  const alumnos = require("../controllers/alumno.controller.js");
  const router = require("express").Router();

  // RF-03 — CRUD de alumnos: gestión exclusiva del Administrador; la consulta es
  // más abierta porque catedráticos/padres necesitan ver datos básicos del alumno.
  router.post("/", [verifyToken, isAdmin], alumnos.create);
  router.get("/", [verifyToken, isAnyRole], alumnos.findAll);
  router.get("/:id", [verifyToken, isAnyRole], alumnos.findOne);
  router.put("/:id", [verifyToken, isAdmin], alumnos.update);
  router.delete("/:id", [verifyToken, isAdmin], alumnos.delete);

  app.use("/api/alumnos", router);
};
