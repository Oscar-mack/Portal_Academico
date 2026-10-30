module.exports = (sequelize, DataTypes) => sequelize.define("cargo", {
  alumnoId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  concepto: {
    type: DataTypes.STRING(160),
    allowNull: false
  },
  descripcion: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  montoOriginal: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    validate: { min: 0.01 }
  },
  moneda: {
    type: DataTypes.STRING(3),
    allowNull: false,
    defaultValue: "GTQ",
    validate: { isIn: [["GTQ", "USD"]] }
  },
  fechaEmision: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  fechaVencimiento: {
    type: DataTypes.DATEONLY,
    allowNull: true
  },
  cicloAcademicoId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  periodoAcademicoId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  anuladoEn: {
    type: DataTypes.DATE,
    allowNull: true
  },
  anuladoPorId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  motivoAnulacion: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: "cargos",
  indexes: [
    { fields: ["alumnoId", "fechaVencimiento"] }
  ],
  validate: {
    vencimientoCoherente() {
      if (this.fechaEmision && this.fechaVencimiento && this.fechaVencimiento < this.fechaEmision) {
        throw new Error("fechaVencimiento no puede ser anterior a fechaEmision.");
      }
      if (this.anuladoEn && !this.motivoAnulacion) {
        throw new Error("motivoAnulacion es obligatorio al anular un cargo.");
      }
    }
  }
});
