const db = require("../models");
const ROLES = require("../config/roles.js");
const Usuario = db.usuarios;

const checkDuplicateUsernameOrEmail = async (req, res, next) => {
  try {
    const usuarioExistente = await Usuario.findOne({ where: { username: req.body.username } });
    if (usuarioExistente) {
      return res.status(400).send({ message: "El nombre de usuario ya está en uso." });
    }

    const emailExistente = await Usuario.findOne({ where: { email: req.body.email } });
    if (emailExistente) {
      return res.status(400).send({ message: "El correo ya está registrado." });
    }

    next();
  } catch (error) {
    res.status(500).send({ message: "Error al validar el usuario." });
  }
};

const checkRolValido = (req, res, next) => {
  const rolesValidos = Object.values(ROLES);
  if (req.body.rol && !rolesValidos.includes(req.body.rol)) {
    return res.status(400).send({
      message: `Rol inválido. Los roles permitidos son: ${rolesValidos.join(", ")}.`
    });
  }
  next();
};

module.exports = { checkDuplicateUsernameOrEmail, checkRolValido };


