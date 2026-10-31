const { verifyToken, hasRole, isAdmin } = require("../middlewares/authJwt.js");
const ROLES = require("../config/roles.js");

module.exports = app => {
	const pagos = require("../controllers/pago.controller.js");
	const router = require("express").Router();

	router.post("/checkout", [verifyToken, hasRole(ROLES.ALUMNO, ROLES.PADRE)], pagos.crearSesion);
	router.post("/:id/cancelar", [verifyToken, hasRole(ROLES.ALUMNO, ROLES.PADRE)], pagos.cancelarCheckout);
	router.get("/", [verifyToken, hasRole(ROLES.ADMIN, ROLES.ALUMNO, ROLES.PADRE)], pagos.findAll);

	router.patch("/:id/anular", [verifyToken, isAdmin], pagos.anular);
	// Un pago es un registro contable: no se elimina, se cancela (pendiente) o se anula (pagado).
	router.delete("/:id", [verifyToken, hasRole(ROLES.ADMIN, ROLES.ALUMNO, ROLES.PADRE)], (req, res) => {
		res.status(405).set("Allow", "GET, PATCH").send({
			message: "Los pagos no se eliminan. Usa PATCH /api/pagos/:id/anular para cancelar o anular el pago con un motivo."
		});
	});

	app.use("/api/pagos", router);
};
