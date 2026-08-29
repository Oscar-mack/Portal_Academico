const { verifyToken, hasRole } = require("../middlewares/authJwt.js");
const ROLES = require("../config/roles.js");

module.exports = app => {
	const pagos = require("../controllers/pago.controller.js");
	const router = require("express").Router();

	router.post("/checkout", [verifyToken, hasRole(ROLES.ALUMNO, ROLES.PADRE)], pagos.crearSesion);
	router.get("/", [verifyToken, hasRole(ROLES.ADMIN, ROLES.ALUMNO, ROLES.PADRE)], pagos.findAll);

	app.use("/api/pagos", router);
};
