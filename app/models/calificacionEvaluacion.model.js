module.exports = (sequelize, DataTypes) => sequelize.define("calificacion_evaluacion", {
  evaluacionId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  alumnoId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  valor: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    validate: { min: 0 }
  }
}, {
  tableName: "calificaciones_evaluacion",
  indexes: [
    { unique: true, fields: ["evaluacionId", "alumnoId"] }
  ]
});
