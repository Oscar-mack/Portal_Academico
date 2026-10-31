module.exports = (sequelize, DataTypes) => sequelize.define("material_curso", {
  cursoId: { type: DataTypes.INTEGER, allowNull: false },
  catedraticoId: { type: DataTypes.INTEGER, allowNull: false },
  periodoAcademicoId: { type: DataTypes.INTEGER, allowNull: false },
  archivoId: { type: DataTypes.INTEGER, allowNull: false, unique: true },
  titulo: { type: DataTypes.STRING(150), allowNull: false },
  descripcion: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
  activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
}, {
  tableName: "materiales_curso",
  indexes: [{ fields: ["cursoId", "periodoAcademicoId", "activo"] }]
});
