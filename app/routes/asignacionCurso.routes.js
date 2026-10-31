const { verifyToken, isAdmin, isAnyRole, hasRole } = require("../middlewares/authJwt.js");
const ROLES = require("../config/roles.js");

module.exports = app => {
	const asignaciones = require("../controllers/asignacionCurso.controller.js");
	const router = require("express").Router();

	router.post("/", [verifyToken, hasRole(ROLES.ADMIN, ROLES.ALUMNO)], asignaciones.create);
	router.get("/", [verifyToken, isAnyRole], asignaciones.findAll);
	router.get("/:id", [verifyToken, isAnyRole], asignaciones.findOne);
	router.put("/:id", [verifyToken, isAdmin], asignaciones.update);
	router.delete("/:id", [verifyToken, isAdmin], asignaciones.delete);

	app.use("/api/asignaciones-curso", router);
};
