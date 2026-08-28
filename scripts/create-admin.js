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
const { Op } = require("sequelize");

const username = process.env.ADMIN_USERNAME;
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
const databaseUrl = process.env.DATABASE_URL;

function validateInput() {
  if (!username || !email || !password) {
    throw new Error(
      "Defina ADMIN_USERNAME, ADMIN_EMAIL y ADMIN_PASSWORD antes de ejecutar este comando."
    );
  }

  if (password.length < 12) {
    throw new Error("ADMIN_PASSWORD debe contener al menos 12 caracteres.");
  }

  if (!databaseUrl || databaseUrl.includes("PEGA_") || databaseUrl.includes("postgresql://postgresql://")) {
    throw new Error(
      "Defina DATABASE_URL con la cadena completa de Neon de la rama production; no use un texto de ejemplo."
    );
  }

  try {
    const parsedUrl = new URL(databaseUrl);
    if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol) || !parsedUrl.hostname.includes("neon.tech")) {
      throw new Error();
    }
  } catch {
    throw new Error("DATABASE_URL no es una URL válida de Neon.");
  }
}

async function createOrResetAdmin() {
  validateInput();
  const db = require("../app/models");
  const ROLES = require("../app/config/roles");

  try {
    await db.sequelize.authenticate();

    const matchingUsers = await db.usuarios.findAll({
      where: {
        [Op.or]: [{ username }, { email }]
      }
    });

    if (matchingUsers.length > 1) {
      throw new Error(
        "El username y el email pertenecen a cuentas diferentes. Use valores que identifiquen una sola cuenta."
      );
    }

    const passwordHash = bcrypt.hashSync(password, 8);
    const existingUser = matchingUsers[0];

    if (existingUser) {
      await existingUser.update({
        username,
        email,
        password: passwordHash,
        rol: ROLES.ADMIN,
        activo: true
      });
      console.log(`Administrador restablecido: ${existingUser.username} (id: ${existingUser.id})`);
    } else {
      const newUser = await db.usuarios.create({
        username,
        email,
        password: passwordHash,
        rol: ROLES.ADMIN,
        activo: true
      });
      console.log(`Administrador creado: ${newUser.username} (id: ${newUser.id})`);
    }
  } finally {
    await db.sequelize.close();
  }
}

createOrResetAdmin().catch((error) => {
  console.error(`No se pudo preparar el administrador: ${error.message}`);
  process.exitCode = 1;
});