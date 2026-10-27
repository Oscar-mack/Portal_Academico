const db = require("../models");
const config = require("../config/auth.config.js");
const ROLES = require("../config/roles.js");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const Usuario = db.usuarios;
const Catedratico = db.catedraticos;
const Alumno = db.alumnos;
const PadreAlumno = db.padresAlumnos;

// Hash dummy para evitar timing attacks: siempre se ejecuta bcrypt.compare aunque el
// usuario no exista, haciendo la respuesta indistinguible por tiempo (RNF-01).
const DUMMY_HASH = bcrypt.hashSync("no-es-una-contrasena-real", 10);
const MIN_PASSWORD_LENGTH = 8;

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

    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      await t.rollback();
      return res.status(400).send({ message: `La contrasena debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` });
    }

    const usuario = await Usuario.create({
      username,
      email,
      password: bcrypt.hashSync(password, 10),
      rol: rol || ROLES.ALUMNO
    }, { transaction: t });

    if (usuario.rol === ROLES.CATEDRATICO && catedraticoId) {
      const catedratico = await Catedratico.findByPk(catedraticoId, { transaction: t });
      if (!catedratico) {
        await t.rollback();
        return res.status(404).send({ message: "El catedratico indicado no existe." });
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
    res.status(500).send({ message: error.message || "Ocurrio un error al registrar el usuario." });
  }
};

// D1: Login atomico — el contador de intentos fallidos se actualiza dentro de una
// transaccion con SELECT FOR UPDATE para evitar que solicitudes concurrentes eludan
// el bloqueo de cuenta al leer el mismo valor de intentosFallidos antes de escribirlo.
exports.signin = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).send({ message: "username y password son requeridos." });
    }

    // Primera lectura sin lock: obtener el hash para ejecutar bcrypt fuera de la tx
    // (bcrypt es lento; no conviene mantener un lock de fila durante su ejecucion).
    const encontrado = await Usuario.findOne({ where: { username } });

    // Siempre ejecutar bcrypt.compare para igualar el tiempo de respuesta
    // independientemente de si el usuario existe o no.
    const hashAComparar = encontrado ? encontrado.password : DUMMY_HASH;
    const passwordValida = await bcrypt.compare(String(password), hashAComparar);

    if (!encontrado) {
      return res.status(401).send({ message: "Credenciales invalidas." });
    }

    // Segunda lectura con lock para serializar las actualizaciones de estado de cuenta.
    return await db.sequelize.transaction(async (t) => {
      const usuario = await Usuario.findByPk(encontrado.id, {
        transaction: t,
        lock: t.LOCK.UPDATE
      });

      // Re-verificar activo dentro del lock por si cambio concurrentemente.
      if (!usuario.activo) {
        return res.status(403).send({ message: "El usuario se encuentra inactivo." });
      }

      if (!passwordValida) {
        // D1: el incremento se hace dentro del lock; dos intentos simultaneos no
        // podran leer el mismo valor y ambos escribir +1 al mismo contador.
        const nuevosIntentos = (usuario.intentosFallidos || 0) + 1;
        await usuario.update(
          {
            intentosFallidos: nuevosIntentos,
            bloqueadoHasta: nuevosIntentos >= 5
              ? new Date(Date.now() + 15 * 60 * 1000)
              : usuario.bloqueadoHasta
          },
          { transaction: t }
        );
        return res.status(401).send({ message: "Credenciales invalidas." });
      }

      // Verificar bloqueo temporal despues de confirmar que la contrasena es valida
      // (evita revelar si la cuenta esta bloqueada antes de verificar credenciales).
      if (usuario.bloqueadoHasta && usuario.bloqueadoHasta > new Date()) {
        return res.status(429).send({ message: "Cuenta temporalmente bloqueada. Intenta mas tarde." });
      }

      // Login exitoso: limpiar contador.
      await usuario.update(
        { intentosFallidos: 0, bloqueadoHasta: null, ultimoLogin: new Date() },
        { transaction: t }
      );

      const token = jwt.sign({ id: usuario.id, rol: usuario.rol }, config.secret, {
        expiresIn: config.expiresIn
      });

      return res.status(200).send({
        message: "Login exitoso",
        token,
        usuario: { id: usuario.id, rol: usuario.rol },
        id: usuario.id,
        username: usuario.username,
        email: usuario.email,
        rol: usuario.rol,
        accessToken: token,
        expiresIn: config.expiresIn
      });
    });
  } catch (error) {
    res.status(500).send({ message: error.message || "Ocurrio un error al iniciar sesion." });
  }
};

// Devuelve el perfil del usuario autenticado (util para el frontend)
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
