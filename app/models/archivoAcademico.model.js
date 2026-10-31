module.exports = (sequelize, DataTypes) => sequelize.define("archivo_academico", {
  storageKey: { type: DataTypes.STRING(500), allowNull: false, unique: true },
  nombreOriginal: { type: DataTypes.STRING(255), allowNull: false },
  mimeType: { type: DataTypes.STRING(120), allowNull: false },
  sizeBytes: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1, max: 20971520 } },
  sha256: { type: DataTypes.STRING(64), allowNull: false },
  subidoPorUsuarioId: { type: DataTypes.INTEGER, allowNull: false }
}, {
  tableName: "archivos_academicos"
});
