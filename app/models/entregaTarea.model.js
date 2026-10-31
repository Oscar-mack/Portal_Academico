module.exports = (sequelize, DataTypes) => sequelize.define("entrega_tarea", {
  tareaId: { type: DataTypes.INTEGER, allowNull: false },
  alumnoId: { type: DataTypes.INTEGER, allowNull: false },
  archivoId: { type: DataTypes.INTEGER, allowNull: false, unique: true },
  entregadaEn: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, {
  tableName: "entregas_tarea",
  indexes: [{ fields: ["tareaId", "alumnoId", "entregadaEn"] }]
});
