module.exports = (sequelize, DataTypes) => {
  const GradoCarrera = sequelize.define("grado_carrera", {
    nombre: {
      type: DataTypes.STRING,
      allowNull: false
    },
    nivel: {
      type: DataTypes.STRING // ej. "Diversificado", "Universitario"
    },
    descripcion: {
      type: DataTypes.TEXT
    },
    activo: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  });

  return GradoCarrera;
};

