const { verifyToken, isAdmin, isAnyRole } = require("../middlewares/authJwt.js");

module.exports = app => {
	const horarios = require("../controllers/horarioCatedratico.controller.js");
	const router = require("express").Router();

	router.post("/", [verifyToken, isAdmin], horarios.create);
	router.get("/", [verifyToken, isAnyRole], horarios.findAll);
	router.get("/:id", [verifyToken, isAnyRole], horarios.findOne);
	router.put("/:id", [verifyToken, isAdmin], horarios.update);
	router.delete("/:id", [verifyToken, isAdmin], horarios.delete);

	app.use("/api/horarios-catedratico", router);
};
