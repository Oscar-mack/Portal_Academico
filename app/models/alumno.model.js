module.exports = (sequelize, DataTypes) => {
  const Alumno = sequelize.define("alumno", {
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
    // RN-01: un alumno debe estar asociado a un grado o carrera
    gradoCarreraId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    activo: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  });

  return Alumno;
};
