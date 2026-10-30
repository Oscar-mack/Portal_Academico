module.exports = (sequelize, DataTypes) => sequelize.define("periodo_academico", {
  cicloAcademicoId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  nombre: {
    type: DataTypes.STRING(80),
    allowNull: false
  },
  tipo: {
    type: DataTypes.STRING(12),
    allowNull: false,
    validate: { isIn: [["bimestre", "trimestre", "semestre"]] }
  },
  fechaInicio: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  fechaFin: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  estado: {
    type: DataTypes.STRING(12),
    allowNull: false,
    defaultValue: "abierto",
    validate: { isIn: [["abierto", "cerrado"]] }
  }
}, {
  tableName: "periodos_academicos",
  indexes: [
    { unique: true, fields: ["cicloAcademicoId", "nombre"] }
  ],
  validate: {
    fechasCoherentes() {
      if (this.fechaInicio && this.fechaFin && this.fechaInicio > this.fechaFin) {
        throw new Error("fechaInicio debe ser anterior o igual a fechaFin.");
      }
    }
  }
});
