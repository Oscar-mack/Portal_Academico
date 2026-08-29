const path = require("path");

const nodeEnv = process.env.NODE_ENV || "development";
require("dotenv").config({
  path: path.resolve(__dirname, "..", `.env.${nodeEnv}`),
  quiet: true
});
require("dotenv").config({
  path: path.resolve(__dirname, "..", ".env"),
  quiet: true
});

const bcrypt = require("bcryptjs");
const db = require("../app/models");

const username = process.env.RESET_USERNAME;
const password = process.env.RESET_PASSWORD;

async function resetPassword() {
  if (!username || !password) {
    throw new Error("Defina RESET_USERNAME y RESET_PASSWORD antes de ejecutar este comando.");
  }

  if (password.length < 12) {
    throw new Error("RESET_PASSWORD debe contener al menos 12 caracteres.");
  }

  try {
    const usuario = await db.usuarios.findOne({ where: { username } });
    if (!usuario) {
      throw new Error(`No existe un usuario con username=${username}.`);
    }

    await usuario.update({
      password: bcrypt.hashSync(password, 10),
      activo: true
    });
    console.log(`Contraseña restablecida para el usuario ${usuario.username}.`);
  } finally {
    await db.sequelize.close();
  }
}

resetPassword().catch((error) => {
  console.error(`No se pudo restablecer la contraseña: ${error.message}`);
  process.exitCode = 1;
});