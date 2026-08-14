const { verifyToken, isAnyRole } = require("../middlewares/authJwt.js");

module.exports = app => {
	const pagos = require("../controllers/pago.controller.js");
	const router = require("express").Router();

	router.post("/webhook", require("express").raw({ type: "application/json" }), pagos.webhook);
	router.post("/checkout", [verifyToken, isAnyRole], pagos.crearSesion);
	router.get("/", [verifyToken, isAnyRole], pagos.findAll);

	app.use("/api/pagos", router);
};
