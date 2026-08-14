module.exports = (sequelize, DataTypes) => {
  const Curso = sequelize.define("curso", {
    nombre: {
      type: DataTypes.STRING,
      allowNull: false
    },
    codigo: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    creditos: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    // RN-02: un curso debe pertenecer a un grado o carrera
    gradoCarreraId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    activo: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  });

  return Curso;
};

