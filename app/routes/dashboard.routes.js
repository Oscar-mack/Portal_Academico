const { verifyToken, isAnyRole } = require("../middlewares/authJwt.js");

module.exports = app => {
  const dashboard = require("../controllers/dashboard.controller.js");
  const router = require("express").Router();

  router.get("/", [verifyToken, isAnyRole], dashboard.get);
  app.use("/api/dashboard", router);
};
