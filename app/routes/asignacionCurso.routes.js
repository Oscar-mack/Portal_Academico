const { verifyToken, isAdmin, isAnyRole } = require("../middlewares/authJwt.js");

module.exports = app => {
	const asignaciones = require("../controllers/asignacionCurso.controller.js");
	const router = require("express").Router();

	router.post("/", [verifyToken, isAdmin], asignaciones.create);
	router.get("/", [verifyToken, isAnyRole], asignaciones.findAll);
	router.get("/:id", [verifyToken, isAnyRole], asignaciones.findOne);
	router.put("/:id", [verifyToken, isAdmin], asignaciones.update);
	router.delete("/:id", [verifyToken, isAdmin], asignaciones.delete);

	app.use("/api/asignaciones-curso", router);
};
