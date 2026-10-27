const db = require("../models");
const ROLES = require("../config/roles.js");

const Usuario = db.usuarios;
const Catedratico = db.catedraticos;
const Alumno = db.alumnos;

const SIN_PASSWORD = { exclude: ["password"] };

// RNF-02 — Gestion de cuentas: exclusiva del Administrador
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
      return res.status(404).send({ message: `No se encontro el usuario con id=${req.params.id}.` });
    }
    res.send(usuario);
  } catch (error) {
    res.status(500).send({ message: "Error al obtener el usuario." });
  }
};

// Solo permite editar username, email, rol y activo; la contrasena se cambia
// mediante el flujo de restablecimiento, no por esta via.
exports.update = async (req, res) => {
  try {
    const usuario = await Usuario.findByPk(req.params.id);
    if (!usuario) {
      return res.status(404).send({ message: `No se encontro el usuario con id=${req.params.id}.` });
    }

    const { username, email, rol, activo } = req.body;
    if (rol && !Object.values(ROLES).includes(rol)) {
      return res.status(400).send({
        message: `Rol invalido. Los roles permitidos son: ${Object.values(ROLES).join(", ")}.`
      });
    }

    // D2: Proteger el ultimo administrador activo.
    // Si se intenta desactivar o cambiar el rol del unico admin activo, rechazar.
    const estaDesactivando = activo === false && usuario.activo === true;
    const estaCambiandoRolDeAdmin = rol && rol !== ROLES.ADMIN && usuario.rol === ROLES.ADMIN;

    if (estaDesactivando || estaCambiandoRolDeAdmin) {
      if (usuario.rol === ROLES.ADMIN) {
        const totalAdminsActivos = await Usuario.count({ where: { rol: ROLES.ADMIN, activo: true } });
        if (totalAdminsActivos <= 1) {
          return res.status(409).send({
            message: "No es posible desactivar o cambiar el rol del unico administrador activo. Designa otro administrador primero."
          });
        }
      }
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

    // D2: No permitir eliminar el unico admin activo.
    const usuario = await Usuario.findByPk(req.params.id);
    if (usuario && usuario.rol === ROLES.ADMIN) {
      const totalAdminsActivos = await Usuario.count({ where: { rol: ROLES.ADMIN, activo: true } });
      if (totalAdminsActivos <= 1) {
        return res.status(409).send({
          message: "No es posible eliminar el unico administrador activo."
        });
      }
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
