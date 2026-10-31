const { verifyToken, hasRole } = require("../middlewares/authJwt.js");
const ROLES = require("../config/roles.js");

module.exports = app => {
  const tareas = require("../controllers/tarea.controller.js");
  const router = require("express").Router();
  const manage = [verifyToken, hasRole(ROLES.ADMIN, ROLES.CATEDRATICO)];
  const read = [verifyToken, hasRole(ROLES.ADMIN, ROLES.CATEDRATICO, ROLES.ALUMNO)];

  router.get("/", read, tareas.findAll);
  router.post("/", manage, tareas.create);
  router.get("/:id", read, tareas.findOne);
  router.put("/:id", manage, tareas.update);
  router.delete("/:id", manage, tareas.deactivate);
  router.post("/:id/adjuntos", manage, tareas.addAttachment);
  router.get("/:id/entregas", manage, tareas.getSubmissions);
  router.post("/:id/entregas", [verifyToken, hasRole(ROLES.ALUMNO)], tareas.submit);
  router.get("/:id/mi-entrega", [verifyToken, hasRole(ROLES.ALUMNO)], tareas.mySubmission);

  app.use("/api/tareas", router);
};
