module.exports = (sequelize, DataTypes) => sequelize.define("adjunto_tarea", {
  tareaId: { type: DataTypes.INTEGER, allowNull: false },
  archivoId: { type: DataTypes.INTEGER, allowNull: false, unique: true }
}, {
  tableName: "adjuntos_tarea",
  indexes: [{ unique: true, fields: ["tareaId", "archivoId"] }]
});
