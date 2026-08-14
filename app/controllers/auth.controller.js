const db = require("../models");
const config = require("../config/auth.config.js");
const ROLES = require("../config/roles.js");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const Usuario = db.usuarios;
const Catedratico = db.catedraticos;
const Alumno = db.alumnos;
const PadreAlumno = db.padresAlumnos;

// RF: registro de usuarios del portal, con vínculo opcional a su perfil
// académico según el rol (catedratico -> catedraticoId, alumno -> alumnoId,
// padre -> alumnoIds[] para poder consultar las notas de sus hijos).
exports.signup = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const { username, email, password, rol, catedraticoId, alumnoId, alumnoIds } = req.body;

    if (!username || !email || !password) {
      await t.rollback();
      return res.status(400).send({ message: "username, email y password son requeridos." });
    }

    const usuario = await Usuario.create({
      username,
      email,
      password: bcrypt.hashSync(password, 8),
      rol: rol || ROLES.ALUMNO
    }, { transaction: t });

    if (usuario.rol === ROLES.CATEDRATICO && catedraticoId) {
      const catedratico = await Catedratico.findByPk(catedraticoId, { transaction: t });
      if (!catedratico) {
        await t.rollback();
        return res.status(404).send({ message: "El catedrático indicado no existe." });
      }
      catedratico.usuarioId = usuario.id;
      await catedratico.save({ transaction: t });
    }

    if (usuario.rol === ROLES.ALUMNO && alumnoId) {
      const alumno = await Alumno.findByPk(alumnoId, { transaction: t });
      if (!alumno) {
        await t.rollback();
        return res.status(404).send({ message: "El alumno indicado no existe." });
      }
      alumno.usuarioId = usuario.id;
      await alumno.save({ transaction: t });
    }

    if (usuario.rol === ROLES.PADRE && Array.isArray(alumnoIds) && alumnoIds.length > 0) {
      for (const idAlumno of alumnoIds) {
        const alumno = await Alumno.findByPk(idAlumno, { transaction: t });
        if (!alumno) {
          await t.rollback();
          return res.status(404).send({ message: `El alumno con id=${idAlumno} no existe.` });
        }
        await PadreAlumno.create({ usuarioId: usuario.id, alumnoId: idAlumno }, { transaction: t });
      }
    }

    await t.commit();
    res.send({ message: "Usuario registrado exitosamente!", id: usuario.id, rol: usuario.rol });
  } catch (error) {
    await t.rollback();
    res.status(500).send({ message: error.message || "Ocurrió un error al registrar el usuario." });
  }
};

exports.signin = async (req, res) => {
  try {
    const usuario = await Usuario.findOne({ where: { username: req.body.username } });

    if (!usuario) {
      return res.status(404).send({ message: "Usuario no encontrado." });
    }
    if (!usuario.activo) {
      return res.status(403).send({ message: "El usuario se encuentra inactivo." });
    }

    const passwordValida = bcrypt.compareSync(req.body.password, usuario.password);
    if (!passwordValida) {
      return res.status(401).send({ message: "Contraseña incorrecta." });
    }

    const token = jwt.sign({ id: usuario.id, rol: usuario.rol }, config.secret, {
      expiresIn: config.expiresIn
    });

    res.status(200).send({
      id: usuario.id,
      username: usuario.username,
      email: usuario.email,
      rol: usuario.rol,
      accessToken: token,
      expiresIn: config.expiresIn
    });
  } catch (error) {
    res.status(500).send({ message: error.message || "Ocurrió un error al iniciar sesión." });
  }
};

// Devuelve el perfil del usuario autenticado (útil para el frontend)
exports.perfil = async (req, res) => {
  try {
    const usuario = await Usuario.findByPk(req.userId, {
      attributes: { exclude: ["password"] },
      include: [
        { model: Catedratico, as: "perfilCatedratico" },
        { model: Alumno, as: "perfilAlumno" }
      ]
    });
    if (!usuario) {
      return res.status(404).send({ message: "Usuario no encontrado." });
    }
    res.send(usuario);
  } catch (error) {
    res.status(500).send({ message: "Error al obtener el perfil." });
  }
};


