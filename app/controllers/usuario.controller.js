const db = require("../models");
const ROLES = require("../config/roles.js");

const Usuario = db.usuarios;
const Catedratico = db.catedraticos;
const Alumno = db.alumnos;

const SIN_PASSWORD = { exclude: ["password"] };

// RNF-02 — Gestión de cuentas: exclusiva del Administrador
exports.findAll = async (req, res) => {
  try {
    const where = {};
    if (req.query.rol) where.rol = req.query.rol;

    const usuarios = await Usuario.findAll({ where, attributes: SIN_PASSWORD, order: [["id", "ASC"]] });
    res.send(usuarios);
  } catch (error) {
    res.status(500).send({ message: "Error al obtener los usuarios." });
  }
};

exports.findOne = async (req, res) => {
  try {
    const usuario = await Usuario.findByPk(req.params.id, {
      attributes: SIN_PASSWORD,
      include: [
        { model: Catedratico, as: "perfilCatedratico" },
        { model: Alumno, as: "perfilAlumno" }
      ]
    });
    if (!usuario) {
      return res.status(404).send({ message: `No se encontró el usuario con id=${req.params.id}.` });
    }
    res.send(usuario);
  } catch (error) {
    res.status(500).send({ message: "Error al obtener el usuario." });
  }
};

// Solo permite editar username, email, rol y activo; la contraseña se cambia
// mediante el flujo de restablecimiento, no por esta vía.
exports.update = async (req, res) => {
  try {
    const usuario = await Usuario.findByPk(req.params.id);
    if (!usuario) {
      return res.status(404).send({ message: `No se encontró el usuario con id=${req.params.id}.` });
    }

    const { username, email, rol, activo } = req.body;
    if (rol && !Object.values(ROLES).includes(rol)) {
      return res.status(400).send({
        message: `Rol inválido. Los roles permitidos son: ${Object.values(ROLES).join(", ")}.`
      });
    }

    await usuario.update({
      username: username ?? usuario.username,
      email: email ?? usuario.email,
      rol: rol ?? usuario.rol,
      activo: activo ?? usuario.activo
    });

    res.send({ message: "Usuario actualizado exitosamente." });
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al actualizar el usuario." });
  }
};

exports.delete = async (req, res) => {
  try {
    if (Number(req.params.id) === req.userId) {
      return res.status(400).send({ message: "No puedes eliminar tu propia cuenta." });
    }

    const num = await Usuario.destroy({ where: { id: req.params.id } });
    if (num === 1) {
      res.send({ message: "Usuario eliminado exitosamente." });
    } else {
      res.status(404).send({ message: `No se pudo eliminar el usuario con id=${req.params.id}.` });
    }
  } catch (error) {
    res.status(500).send({ message: "Error al eliminar el usuario." });
  }
};
