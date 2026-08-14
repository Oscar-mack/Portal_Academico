const { verifyToken, isAdmin, isAnyRole } = require("../middlewares/authJwt.js");

module.exports = app => {
	const cursos = require("../controllers/curso.controller.js");
	const router = require("express").Router();

	router.post("/", [verifyToken, isAdmin], cursos.create);
	router.get("/", [verifyToken, isAnyRole], cursos.findAll);
	router.get("/:id", [verifyToken, isAnyRole], cursos.findOne);
	router.put("/:id", [verifyToken, isAdmin], cursos.update);
	router.delete("/:id", [verifyToken, isAdmin], cursos.delete);

	app.use("/api/cursos", router);
};
