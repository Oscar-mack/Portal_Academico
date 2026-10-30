module.exports = (sequelize, DataTypes) => sequelize.define("requisito_solvencia_documento", {
  tipoDocumento: {
    type: DataTypes.STRING(80),
    allowNull: false,
    unique: true
  },
  requiereSolvencia: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: "requiere_solvencia"
  }
}, { tableName: "requisitos_solvencia_documentos" });
