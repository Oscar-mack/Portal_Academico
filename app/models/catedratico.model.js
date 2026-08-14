module.exports = (sequelize, DataTypes) => {
  const Catedratico = sequelize.define("catedratico", {
    nombre: {
      type: DataTypes.STRING,
      allowNull: false
    },
    apellido: {
      type: DataTypes.STRING,
      allowNull: false
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: { isEmail: true }
    },
    telefono: {
      type: DataTypes.STRING
    },
    especialidad: {
      type: DataTypes.STRING
    },
    activo: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  });

  return Catedratico;
};

