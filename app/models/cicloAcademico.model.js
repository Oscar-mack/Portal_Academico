module.exports = (sequelize, DataTypes) => sequelize.define("ciclo_academico", {
  nombre: {
    type: DataTypes.STRING(80),
    allowNull: false,
    unique: true
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
  tableName: "ciclos_academicos",
  validate: {
    fechasCoherentes() {
      if (this.fechaInicio && this.fechaFin && this.fechaInicio > this.fechaFin) {
        throw new Error("fechaInicio debe ser anterior o igual a fechaFin.");
      }
    }
  }
});
