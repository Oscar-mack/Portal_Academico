const ROLES = require("../config/roles.js");

module.exports = (sequelize, DataTypes) => {
  const Usuario = sequelize.define("usuario", {
    username: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: { isEmail: true }
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false
    },
    rol: {
      type: DataTypes.ENUM(ROLES.ADMIN, ROLES.CATEDRATICO, ROLES.ALUMNO, ROLES.PADRE),
      allowNull: false,
      defaultValue: ROLES.ALUMNO
    },
    activo: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    // D1: campos para bloqueo de cuenta por intentos fallidos
    intentosFallidos: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false
    },
    bloqueadoHasta: {
      type: DataTypes.DATE,
      allowNull: true
    },
    ultimoLogin: {
      type: DataTypes.DATE,
      allowNull: true
    }
  });

  return Usuario;
};
