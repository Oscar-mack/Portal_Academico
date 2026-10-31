module.exports = (sequelize, DataTypes) => sequelize.define("auditoria_tarea", {
  tareaId: { type: DataTypes.INTEGER, allowNull: true },
  archivoId: { type: DataTypes.INTEGER, allowNull: true },
  usuarioId: { type: DataTypes.INTEGER, allowNull: false },
  accion: { type: DataTypes.STRING(40), allowNull: false },
  detalle: { type: DataTypes.TEXT, allowNull: true }
}, {
  tableName: "auditoria_tareas",
  indexes: [{ fields: ["tareaId", "createdAt"] }]
});
