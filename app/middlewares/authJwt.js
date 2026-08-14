const jwt = require("jsonwebtoken");
const authConfig = require("../config/auth.config.js");
const ROLES = require("../config/roles.js");
const db = require("../models");
const Usuario = db.usuarios;

// Verifica que la petición traiga un JWT válido (RNF-01 — Seguridad)
const verifyToken = (req, res, next) => {
  let token = req.headers["x-access-token"] || req.headers["authorization"];

  if (token && token.startsWith("Bearer ")) {
    token = token.slice(7).trim();
  }

  if (!token) {
    return res.status(403).send({ message: "No se proporcionó ningún token." });
  }

  jwt.verify(token, authConfig.secret, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "No autorizado: token inválido o expirado." });
    }
    req.userId = decoded.id;
    req.userRole = decoded.rol;
    next();
  });
};

// Fábrica de middlewares de autorización por rol (RNF-02 — Roles)
const hasRole = (...rolesPermitidos) => {
  return async (req, res, next) => {
    try {
      if (!req.userRole) {
        const usuario = await Usuario.findByPk(req.userId);
        if (!usuario) {
          return res.status(404).send({ message: "Usuario no encontrado." });
        }
        req.userRole = usuario.rol;
      }

      if (!rolesPermitidos.includes(req.userRole)) {
        return res.status(403).send({
          message: `Acceso denegado. Se requiere alguno de estos roles: ${rolesPermitidos.join(", ")}.`
        });
      }
      next();
    } catch (error) {
      res.status(500).send({ message: "Error al verificar el rol del usuario." });
    }
  };
};

const isAdmin = hasRole(ROLES.ADMIN);
const isCatedratico = hasRole(ROLES.CATEDRATICO);
const isAlumno = hasRole(ROLES.ALUMNO);
const isPadre = hasRole(ROLES.PADRE);
const isAdminOrCatedratico = hasRole(ROLES.ADMIN, ROLES.CATEDRATICO);
const isAnyRole = hasRole(ROLES.ADMIN, ROLES.CATEDRATICO, ROLES.ALUMNO, ROLES.PADRE);

module.exports = {
  verifyToken,
  hasRole,
  isAdmin,
  isCatedratico,
  isAlumno,
  isPadre,
  isAdminOrCatedratico,
  isAnyRole
};

