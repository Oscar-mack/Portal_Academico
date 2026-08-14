module.exports = (sequelize, DataTypes) => {
  // RN-08 — Un padre/tutor solamente podrá consultar las calificaciones del alumno asociado
  const PadreAlumno = sequelize.define("padre_alumno", {
    usuarioId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    alumnoId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    parentesco: {
      type: DataTypes.STRING, // "Madre", "Padre", "Tutor legal", etc.
      defaultValue: "Tutor"
    }
  }, {
    indexes: [
      { unique: true, fields: ["usuarioId", "alumnoId"] }
    ]
  });

  return PadreAlumno;
};


