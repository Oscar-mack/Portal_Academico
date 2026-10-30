module.exports = (sequelize, DataTypes) => sequelize.define("evaluacion", {
  cursoId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  catedraticoId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  periodoAcademicoId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  nombre: {
    type: DataTypes.STRING(120),
    allowNull: false
  },
  puntajeMaximo: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    validate: { min: 0.01, max: 100 }
  },
  activo: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  }
}, {
  tableName: "evaluaciones",
  indexes: [
    { unique: true, fields: ["cursoId", "periodoAcademicoId", "nombre"] }
  ]
});
